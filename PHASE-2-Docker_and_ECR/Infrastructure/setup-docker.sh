#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# ZeetaFin Phase 2 bootstrap
#
# Runs on the OPERATOR machine (Git Bash / WSL / Linux / macOS), not on the
# server. It drives the freshly-provisioned Docker host over SSH and takes the
# deployment from "bare Ubuntu instance" to "application served over HTTPS":
#
#   1. install Docker, AWS CLI v2, nginx and certbot
#   2. upload the local application source (the two ZeetaFin directories)
#   3. generate secrets and deploy postgres + backend + frontend
#   4. put nginx + a Let's Encrypt certificate in front
#
# The application source is taken from the local Application/ tree, never cloned
# from a remote: the operator's working copy is the source of truth. Version
# control metadata, node_modules and any local .env are excluded from the upload.
#
# It stops there on purpose. `aws configure` and the ECR push need credentials
# that must never live in Terraform, so they stay manual. See docs/DEPLOYMENT.md.
#
# Called automatically by `terraform apply` (bootstrap.tf, local-exec).
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../Application" && pwd)"

SERVER_IP=""
SSH_USER="ubuntu"
KEY_FILE=""
KEY_B64=""
DOMAIN="zeetafin.duckdns.org"
DUCKDNS_TOKEN=""
LE_EMAIL=""
ECR_REGISTRY=""
ECR_REPO_URL=""
REGION=""
PROJECT="Docker"
REMOTE_BASE="zeetafin"
BACKEND_SRC="${APP_DIR}/Backend/ZeetaFin-BE"
FRONTEND_SRC="${APP_DIR}/Frontend/ZeetaFin-FE"
FORCE_SECRETS=""

LOCAL_TMP=""

usage() {
  cat <<'EOF'
Usage: setup-docker.sh -H <ip> [options]

  -H IP    Public IP of the Docker host (required)
  -u USER  SSH user (default: ubuntu)
  -K B64   Base64-encoded private key path (used by terraform local-exec)
  -d NAME  Public hostname for nginx/certbot (default: zeetafin.duckdns.org)
  -t TOK   DuckDNS API token; when set, the record is pointed at the instance
  -e MAIL  Let's Encrypt contact email
  -c REG   ECR registry hostname (final hint only)
  -r URL   ECR repository URL (final hint only)
  -R REG   AWS region (final hint only)
  -P NAME  Project name
  -f       Force-regenerate secrets (rotates the database password)
  -h       Show this help

Called automatically by 'terraform apply'.
EOF
}

cleanup() {
  [ -n "$LOCAL_TMP" ] && rm -rf "$LOCAL_TMP"
  return 0
}
trap cleanup EXIT

# Bridge Windows paths (C:\Users\...) to the forms Bash actually understands.
resolve_key() {
  local given="$1"
  local base home_expanded normalized drive
  home_expanded="${given/#\~/$HOME}"
  normalized="${home_expanded//\\//}"
  base="$(basename "$normalized")"

  local candidates=("$given" "$home_expanded" "$normalized")
  if [[ "$normalized" =~ ^[A-Za-z]:/ ]]; then
    drive="${normalized:0:1}"
    candidates+=("/mnt/${drive,,}/${normalized:3}")
  fi
  candidates+=("$HOME/.ssh/$base")
  if [ -n "${USERPROFILE:-}" ]; then
    candidates+=("${USERPROFILE//\\//}/.ssh/$base")
  fi

  for candidate in "${candidates[@]}"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  for candidate in /mnt/*/Users/*/.ssh/"$base" /mnt/*/home/*/.ssh/"$base"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

while getopts ":H:u:K:d:t:e:c:r:R:P:fh" opt; do
  case "$opt" in
    H) SERVER_IP="$OPTARG" ;;
    u) SSH_USER="$OPTARG" ;;
    K) KEY_B64="$OPTARG" ;;
    d) DOMAIN="$OPTARG" ;;
    t) DUCKDNS_TOKEN="$OPTARG" ;;
    e) LE_EMAIL="$OPTARG" ;;
    c) ECR_REGISTRY="$OPTARG" ;;
    r) ECR_REPO_URL="$OPTARG" ;;
    R) REGION="$OPTARG" ;;
    P) PROJECT="$OPTARG" ;;
    f) FORCE_SECRETS="1" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

if [ -z "$KEY_FILE" ] && [ -n "$KEY_B64" ]; then
  KEY_FILE="$(printf '%s' "$KEY_B64" | base64 -d)"
fi

echo "==> 1/8 Resolving the server, key and domain"
if [ -z "$SERVER_IP" ] && command -v terraform >/dev/null 2>&1; then
  SERVER_IP="$(terraform -chdir="${SCRIPT_DIR}" output -raw server_public_ip 2>/dev/null || true)"
fi
[ -n "$KEY_FILE" ] && KEY_FILE="${KEY_FILE/#\~/$HOME}"

if [ -z "$SERVER_IP" ]; then
  echo "ERROR: server IP unknown. Pass -H <ip> or run 'terraform apply'." >&2
  exit 1
fi
if [ -z "$KEY_FILE" ]; then
  echo "ERROR: no private key given. Pass -K." >&2
  exit 1
fi
if ! KEY_FILE="$(resolve_key "$KEY_FILE")"; then
  echo "ERROR: private key '$KEY_FILE' not found." >&2
  exit 1
fi

LOCAL_TMP="$(mktemp -d)"
chmod 700 "$LOCAL_TMP"
cp "$KEY_FILE" "$LOCAL_TMP/key"
chmod 600 "$LOCAL_TMP/key"
if ! ssh-keygen -y -f "$LOCAL_TMP/key" >/dev/null 2>&1; then
  echo "ERROR: OpenSSH will not accept '$KEY_FILE' (passphrase or permissions)." >&2
  exit 1
fi
echo "    server : $SERVER_IP ($SSH_USER)"
echo "    domain : $DOMAIN"

SSH_CMD=(ssh -i "$LOCAL_TMP/key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$LOCAL_TMP/known_hosts" "$SSH_USER@$SERVER_IP")
SCP_CMD=(scp -i "$LOCAL_TMP/key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$LOCAL_TMP/known_hosts")
REMOTE_DEST="$SSH_USER@$SERVER_IP:$REMOTE_BASE"

echo "==> 2/8 Waiting for SSH on $SERVER_IP"
for attempt in $(seq 1 30); do
  if "${SSH_CMD[@]}" true 2>/dev/null; then
    echo "    reachable after ${attempt} attempt(s)"
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "ERROR: cannot reach $SERVER_IP over SSH." >&2
    exit 1
  fi
  sleep 10
done

echo "==> 3/8 Installing Docker, AWS CLI, nginx and certbot"
"${SSH_CMD[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg nginx openssl unzip

if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker

# Let the login user drive Docker without sudo. Idempotent: a no-op if the user
# is already a member. The group takes effect on the next login, i.e. for the
# build and deploy sessions below, which are fresh SSH connections.
sudo usermod -aG docker "$(id -un)"

if ! command -v aws >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "$tmp/awscliv2.zip"
  unzip -q "$tmp/awscliv2.zip" -d "$tmp"
  sudo "$tmp/aws/install" --update
  rm -rf "$tmp"
fi

sudo apt-get install -y certbot python3-certbot-nginx

docker --version
aws --version
nginx -version
REMOTE

echo "==> 4/8 Uploading the application source"
for src in "$BACKEND_SRC" "$FRONTEND_SRC"; do
  if [ ! -d "$src" ]; then
    echo "ERROR: application source not found: $src" >&2
    echo "       The local Application/ tree is the source of truth; populate it first." >&2
    exit 1
  fi
done

# Ship the operator's working copy, not a clone. Exclude version-control
# metadata, installed dependencies, build output and any local .env, so no
# secret or stale artifact crosses the wire.
tar -C "$BACKEND_SRC" \
  --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='dist' --exclude='build' --exclude='.env' \
  -czf "$LOCAL_TMP/backend.tar.gz" .
tar -C "$FRONTEND_SRC" \
  --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='dist' --exclude='build' --exclude='.env' \
  -czf "$LOCAL_TMP/frontend.tar.gz" .

"${SCP_CMD[@]}" "$LOCAL_TMP/backend.tar.gz" "$LOCAL_TMP/frontend.tar.gz" \
  "$SSH_USER@$SERVER_IP:"

"${SSH_CMD[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
base="$HOME/zeetafin"
mkdir -p "$base"
rm -rf "$base/ZeetaFin-BE" "$base/ZeetaFin-FE"
mkdir -p "$base/ZeetaFin-BE" "$base/ZeetaFin-FE"
tar -xzf "$HOME/backend.tar.gz" -C "$base/ZeetaFin-BE"
tar -xzf "$HOME/frontend.tar.gz" -C "$base/ZeetaFin-FE"
rm -f "$HOME/backend.tar.gz" "$HOME/frontend.tar.gz"
REMOTE

echo "==> 5/8 Uploading deploy.sh and generating secrets"
"${SCP_CMD[@]}" "$APP_DIR/deploy.sh" "$REMOTE_DEST/deploy.sh"
"${SSH_CMD[@]}" "chmod +x ~/$REMOTE_BASE/deploy.sh"

# Secrets are generated once and kept across re-runs. Regenerating them would
# rotate the database password and JWT secret while the existing Postgres volume
# still holds the old password, breaking the running stack. Pass -f to force a
# rotation on purpose.
if [ -z "$FORCE_SECRETS" ] && "${SSH_CMD[@]}" "test -f ~/$REMOTE_BASE/.env"; then
  echo "    .env already present; keeping the existing secrets"
else
  [ -n "$FORCE_SECRETS" ] && echo "    regenerating secrets (-f)"
  {
    echo "# Generated by setup-docker.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Do not commit."
    echo "POSTGRES_USER=postgres"
    echo "POSTGRES_DB=zeetafin"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "BIND_ADDR=127.0.0.1"
    echo "FRONTEND_PORT=3000"
    echo "BACKEND_PORT=3001"
    echo "RESTART_POLICY=unless-stopped"
  } > "$LOCAL_TMP/.env"
  "${SCP_CMD[@]}" "$LOCAL_TMP/.env" "$REMOTE_DEST/.env"
  "${SSH_CMD[@]}" "chmod 600 ~/$REMOTE_BASE/.env"
fi

echo "==> 6/8 Building the application images"
"${SSH_CMD[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd "$HOME/zeetafin"
# Prefer the docker group (granted in step 3, active for this fresh login);
# fall back to sudo only if it is not yet in effect.
if id -nG | grep -qw docker; then DOCKER=docker; else DOCKER="sudo docker"; fi
$DOCKER build -t zeetafin-be:latest ZeetaFin-BE
$DOCKER build -t zeetafin-fe:latest ZeetaFin-FE
$DOCKER image ls zeetafin-be:latest
$DOCKER image ls zeetafin-fe:latest
REMOTE

echo "==> 7/8 Deploying the containers"
"${SSH_CMD[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd "$HOME/zeetafin"
# deploy.sh converges on the desired state: it (re)creates the network, volume
# and containers, so running it again is safe. Run it through the docker group
# when this login has it, else fall back to sudo.
if id -nG | grep -qw docker; then DOCKER=docker; bash deploy.sh; else DOCKER="sudo docker"; sudo bash deploy.sh; fi
echo "    waiting for the API to answer"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/docs >/dev/null 2>&1; then
    echo "    API is up"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: API did not become ready" >&2
    $DOCKER logs zeetafin-be --tail 40 >&2 || true
    exit 1
  fi
  sleep 5
done
$DOCKER ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
REMOTE

echo "==> 8/8 Configuring nginx and obtaining a TLS certificate"
sed "s/server_name [^;]*;/server_name ${DOMAIN};/" "$APP_DIR/nginx.cfg" > "$LOCAL_TMP/zeetafin.conf"
"${SCP_CMD[@]}" "$LOCAL_TMP/zeetafin.conf" "$SSH_USER@$SERVER_IP:/tmp/zeetafin.conf"

if [ -n "$DUCKDNS_TOKEN" ]; then
  sub="${DOMAIN%%.duckdns.org}"
  echo "    updating DuckDNS record $sub -> $SERVER_IP"
  "${SSH_CMD[@]}" "curl -fsS 'https://www.duckdns.org/update?domains=$sub&token=$DUCKDNS_TOKEN&ip=$SERVER_IP' >/dev/null" || true
fi

"${SSH_CMD[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
# Install the base site only on first run. Afterwards the file is certbot-managed
# (it carries the 443 server block), so overwriting it would strip TLS; an
# idempotent re-run therefore leaves it in place.
if [ ! -f /etc/nginx/sites-available/zeetafin ]; then
  sudo install -m 0644 /tmp/zeetafin.conf /etc/nginx/sites-available/zeetafin
fi
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/zeetafin /etc/nginx/sites-enabled/zeetafin
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
REMOTE

EMAIL_ARG="--register-unsafely-without-email"
[ -n "$LE_EMAIL" ] && EMAIL_ARG="-m $LE_EMAIL"

DNS_OK=0
if "${SSH_CMD[@]}" "sudo test -d /etc/letsencrypt/live/$DOMAIN"; then
  # A certificate already exists: re-apply it to nginx without reissuing. No DNS
  # gate is needed, and --keep-until-expiring renews only when actually due.
  echo "    certificate already present; ensuring nginx serves it"
  "${SSH_CMD[@]}" "sudo certbot --nginx -d '$DOMAIN' --non-interactive --agree-tos --keep-until-expiring $EMAIL_ARG --redirect"
  DNS_OK=1
else
  for i in $(seq 1 30); do
    resolved="$("${SSH_CMD[@]}" "getent hosts '$DOMAIN' | awk '{print \$1; exit}'" 2>/dev/null || true)"
    if [ "$resolved" = "$SERVER_IP" ]; then
      DNS_OK=1
      echo "    $DOMAIN -> $SERVER_IP"
      break
    fi
    sleep 10
  done

  if [ "$DNS_OK" -eq 1 ]; then
    "${SSH_CMD[@]}" "sudo certbot --nginx -d '$DOMAIN' --non-interactive --agree-tos $EMAIL_ARG --redirect"
  else
    echo "    WARNING: $DOMAIN does not resolve to $SERVER_IP yet."
    if [ -n "$DUCKDNS_TOKEN" ]; then
      echo "    The DuckDNS update was attempted; DNS may not have propagated."
    else
      echo "    Point it at $SERVER_IP at https://www.duckdns.org/domains, then re-run:"
    fi
    echo "      terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap"
    echo "    The site is already live over HTTP."
  fi
fi

echo "==> Deployment complete"
cat <<EOF

The application is deployed on $SERVER_IP.
  HTTP : http://$DOMAIN
  HTTPS: $([ "$DNS_OK" -eq 1 ] && echo "https://$DOMAIN" || echo "(certificate pending)")

Remaining manual step — put the images in ECR (needs your AWS credentials):

  ssh -i ~/.ssh/id_ed25519 $SSH_USER@$SERVER_IP
  aws configure
  aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
  docker tag zeetafin-be:latest $ECR_REPO_URL:backend  && docker push $ECR_REPO_URL:backend
  docker tag zeetafin-fe:latest $ECR_REPO_URL:frontend && docker push $ECR_REPO_URL:frontend

EOF
