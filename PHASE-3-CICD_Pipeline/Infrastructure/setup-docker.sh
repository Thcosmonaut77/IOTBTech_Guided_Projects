#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# ZeetaFin Phase 3 host bootstrap
#
# Runs on the OPERATOR machine (Git Bash / WSL / Linux / macOS), not on the
# server. It takes a bare Ubuntu instance to the point where a CI pipeline can
# deploy to it:
#
#   1. install Docker, AWS CLI v2, nginx and certbot
#   2. upload the on-host deploy script and the nginx site template
#   3. generate the application .env once (database password + JWT secret)
#   4. put nginx + a Let's Encrypt certificate in front
#
# It intentionally does NOT build or start the application. That is the job of
# .github/workflows/deploy.yml: build in CI, push to ECR, SSH here and run
# deploy.sh with the new image tag. The EC2 instance profile grants pull-only
# access to ECR, so the server never stores AWS credentials.
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
ECR_REPO_NAME=""
REGION=""
PROJECT="DockerCI"
REMOTE_BASE="zeetafin"
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
  -c REG   ECR registry hostname (printed in the hand-off message)
  -r URL   ECR repository URL (printed in the hand-off message)
  -R REG   AWS region (printed in the hand-off message)
  -P NAME  Project name
  -f       Force-regenerate secrets (rotates the database password)
  -h       Show this help
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

if [ -n "$ECR_REPO_URL" ]; then
  ECR_REPO_NAME="${ECR_REPO_URL#*/}"
fi

echo "==> 1/6 Resolving the server, key and domain"
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
echo "    project: $PROJECT"
echo "    domain : $DOMAIN"

SSH_CMD=(ssh -i "$LOCAL_TMP/key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$LOCAL_TMP/known_hosts" "$SSH_USER@$SERVER_IP")
SCP_CMD=(scp -i "$LOCAL_TMP/key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$LOCAL_TMP/known_hosts")
REMOTE_DEST="$SSH_USER@$SERVER_IP:$REMOTE_BASE"

echo "==> 2/6 Waiting for SSH on $SERVER_IP"
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

echo "==> 3/6 Installing Docker, AWS CLI, nginx and certbot"
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

# Let the login user drive Docker without sudo. Idempotent: a no-op if already
# a member. The group is active for the fresh SSH sessions used by CI.
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

echo "==> 4/6 Uploading deploy.sh, nginx.cfg and generating secrets"
"${SSH_CMD[@]}" "mkdir -p ~/$REMOTE_BASE"
"${SCP_CMD[@]}" "$APP_DIR/deploy.sh" "$APP_DIR/nginx.cfg" "$REMOTE_DEST/"
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
    echo "BLUE_BACKEND_PORT=3001"
    echo "BLUE_FRONTEND_PORT=3000"
    echo "GREEN_BACKEND_PORT=3002"
    echo "GREEN_FRONTEND_PORT=3003"
    echo "RESTART_POLICY=unless-stopped"
  } > "$LOCAL_TMP/.env"
  "${SCP_CMD[@]}" "$LOCAL_TMP/.env" "$REMOTE_DEST/.env"
  "${SSH_CMD[@]}" "chmod 600 ~/$REMOTE_BASE/.env"
fi

echo "==> 5/6 Configuring nginx"
sed "s/server_name [^;]*;/server_name ${DOMAIN};/" "$APP_DIR/nginx.cfg" > "$LOCAL_TMP/zeetafin.conf"
"${SCP_CMD[@]}" "$LOCAL_TMP/zeetafin.conf" "$SSH_USER@$SERVER_IP:/tmp/zeetafin.conf"

if [ -n "$DUCKDNS_TOKEN" ]; then
  sub="${DOMAIN%%.duckdns.org}"
  echo "    updating DuckDNS record $sub -> $SERVER_IP"
  "${SSH_CMD[@]}" "curl -fsS 'https://www.duckdns.org/update?domains=$sub&token=$DUCKDNS_TOKEN&ip=$SERVER_IP' >/dev/null" || true
fi

"${SSH_CMD[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
# The upstream file is the blue/green switch point. Create it once; deploy.sh
# rewrites it atomically when it moves traffic between colours.
if [ ! -f /etc/nginx/zeetafin-upstreams.conf ]; then
  sudo tee /etc/nginx/zeetafin-upstreams.conf >/dev/null <<'EOF'
upstream zeetafin_backend {
    server 127.0.0.1:3001;
}

upstream zeetafin_frontend {
    server 127.0.0.1:3000;
}
EOF
  sudo chmod 0644 /etc/nginx/zeetafin-upstreams.conf
fi

# Install the base site only on first run. Afterwards the file is certbot-managed
# (it carries the 443 server block), so overwriting it would strip TLS; an
# idempotent re-run therefore leaves it in place.
if [ ! -f /etc/nginx/sites-available/zeetafin ]; then
  sudo install -m 0644 /tmp/zeetafin.conf /etc/nginx/sites-available/zeetafin
fi

# Migrate a pre-blue/green site in place: keep the certbot TLS block, replace
# the fixed proxy ports with upstream names, and add the include once.
if ! sudo grep -q 'zeetafin-upstreams.conf' /etc/nginx/sites-available/zeetafin; then
  tmp=$(mktemp)
  sudo cat /etc/nginx/sites-available/zeetafin \
    | sed -e 's#proxy_pass http://127\.0\.0\.1:3001;#proxy_pass http://zeetafin_backend;#' \
          -e 's#proxy_pass http://127\.0\.0\.1:3000;#proxy_pass http://zeetafin_frontend;#' \
    > "$tmp"
  {
    printf 'include /etc/nginx/zeetafin-upstreams.conf;\n\n'
    cat "$tmp"
  } > "$tmp.new"
  sudo install -m 0644 "$tmp.new" /etc/nginx/sites-available/zeetafin
  rm -f "$tmp" "$tmp.new"
  echo "Migrated the nginx site to the blue/green upstream include"
fi

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/zeetafin /etc/nginx/sites-enabled/zeetafin
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
REMOTE

echo "==> 6/6 Configuring TLS"
EMAIL_ARG="--register-unsafely-without-email"
[ -n "$LE_EMAIL" ] && EMAIL_ARG="-m $LE_EMAIL"

DNS_OK=0
if "${SSH_CMD[@]}" "sudo test -d /etc/letsencrypt/live/$DOMAIN"; then
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
    echo "    The host is ready; the site will be reachable over HTTP until TLS is issued."
  fi
fi

echo "==> Host bootstrap complete"
cat <<EOF

The host at $SERVER_IP is ready for the pipeline.
  Application directory : ~/$REMOTE_BASE
  Deploy script         : ~/$REMOTE_BASE/deploy.sh
  Secrets file          : ~/$REMOTE_BASE/.env (preserved across re-runs)
  Public URL            : $([ "$DNS_OK" -eq 1 ] && echo "https://$DOMAIN" || echo "http://$DOMAIN (TLS pending)")
  ECR repository        : ${ECR_REPO_URL:-<set ecr_repository output>}
  ECR registry          : ${ECR_REGISTRY:-<set ecr_registry output>}
  AWS region            : ${REGION:-<set region>}

Nothing is running yet. Push to the branch watched by
.github/workflows/deploy.yml (or run the workflow manually) to build, push and
deploy the first image. To deploy by hand:

  ssh -i ~/.ssh/id_ed25519 $SSH_USER@$SERVER_IP
  cd ~/$REMOTE_BASE
  AWS_REGION=$(printf '%q' "$REGION") \\
  ECR_REGISTRY=$(printf '%q' "$ECR_REGISTRY") \\
  ECR_REPOSITORY=$(printf '%q' "${ECR_REPO_NAME:-<ecr_repository_name>}") \\
  IMAGE_TAG=<commit-sha> \\
  bash deploy.sh

EOF
