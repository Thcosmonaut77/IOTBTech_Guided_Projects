#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${TERRAFORM_DIR:-$DIR}"

MASTER_IP="${MASTER_IP:-${ANSIBLE_MASTER_IP:-}}"
SSH_USER="${SSH_USER:-${ANSIBLE_SSH_USER:-ubuntu}}"
KEY_FILE="${KEY_FILE:-${ANSIBLE_SSH_KEY:-}}"
KEY_B64=""
REMOTE_SUBDIR="ansible"
WORKER_IPS=()
LOCAL_TMP=""

usage() {
  cat <<EOF
Usage: ./setup-ansible.sh [options] [worker-ip ...]

Installs and configures Ansible on the master node over SSH, then leaves
docker.yml ready to run.

Options:
  -m IP     Master node IP (default: master_public_ip from Terraform)
  -k FILE   SSH private key (default: private_key_file from Terraform)
  -K BASE64 Base64 encoded private key path, used by terraform apply because
            local-exec environment variables are dropped on Windows
  -u USER   SSH user on the nodes (default: $SSH_USER)
  -t DIR    Terraform directory used to fill in defaults (default: script directory)
  -h        Show this help

Called automatically by 'terraform apply'.
EOF
}

cleanup() {
  [ -n "$LOCAL_TMP" ] && rm -rf "$LOCAL_TMP"
  return 0
}
trap cleanup EXIT

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

while getopts ":m:k:K:u:t:h" opt; do
  case "$opt" in
    m) MASTER_IP="$OPTARG" ;;
    k) KEY_FILE="$OPTARG" ;;
    K) KEY_B64="$OPTARG" ;;
    u) SSH_USER="$OPTARG" ;;
    t) TERRAFORM_DIR="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done
shift $((OPTIND - 1))
WORKER_IPS=("$@")
if [ "${#WORKER_IPS[@]}" -eq 0 ] && [ -n "${ANSIBLE_WORKER_IPS:-}" ]; then
  read -r -a WORKER_IPS <<< "$ANSIBLE_WORKER_IPS"
fi
if [ -z "$KEY_FILE" ] && [ -n "$KEY_B64" ]; then
  KEY_FILE="$(printf '%s' "$KEY_B64" | base64 -d)"
fi

echo "==> 1/6 Resolving master, workers and key"
if [ -z "$MASTER_IP" ] || [ "${#WORKER_IPS[@]}" -eq 0 ] || [ -z "$KEY_FILE" ]; then
  if ! command -v terraform >/dev/null 2>&1; then
    echo "ERROR: terraform CLI not found. Pass -m and the worker IPs explicitly." >&2
    exit 1
  fi
  TF_JSON="$(terraform -chdir="$TERRAFORM_DIR" output -json 2>/dev/null || true)"
  if [ -n "$TF_JSON" ]; then
    mapfile -t TF < <(printf '%s' "$TF_JSON" | python3 -c '
import json, sys
try:
    out = json.load(sys.stdin)
except ValueError:
    sys.exit(0)
val = lambda k: str(out.get(k, {}).get("value", "") or "")
print(val("master_public_ip"))
print(" ".join(str(i) for i in out.get("worker_private_ips", {}).get("value", [])))
print(val("private_key_file"))
' 2>/dev/null)
  fi
  [ -z "$MASTER_IP" ] && MASTER_IP="${TF[0]:-}"
  if [ "${#WORKER_IPS[@]}" -eq 0 ] && [ -n "${TF[1]:-}" ]; then
    read -r -a WORKER_IPS <<< "${TF[1]}"
  fi
  [ -z "$KEY_FILE" ] && KEY_FILE="${TF[2]:-}"
fi

[ -n "$KEY_FILE" ] && KEY_FILE="${KEY_FILE/#\~/$HOME}"

if [ -z "$MASTER_IP" ]; then
  echo "ERROR: master IP unknown. Pass -m <ip> or run 'terraform apply' first." >&2
  exit 1
fi
if [ "${#WORKER_IPS[@]}" -eq 0 ]; then
  echo "ERROR: no worker IPs found. Pass them as arguments or apply first." >&2
  exit 1
fi
if [ -n "$KEY_FILE" ]; then
  KEY_SRC="$KEY_FILE"
  if ! KEY_FILE="$(resolve_key "$KEY_FILE")"; then
    echo "ERROR: private key '$KEY_SRC' not found." >&2
    echo "       Looked in: $KEY_SRC, $HOME/.ssh/$(basename "$KEY_SRC"), /mnt/*/Users/*/.ssh/" >&2
    echo "       Pass -k /full/path/to/key" >&2
    exit 1
  fi
else
  echo "ERROR: no private key given. Pass -k /full/path/to/key." >&2
  exit 1
fi

PUB_KEY=""
if [ -f "$KEY_FILE.pub" ]; then
  PUB_KEY="$(cat "$KEY_FILE.pub")"
fi

LOCAL_TMP="$(mktemp -d)"
chmod 700 "$LOCAL_TMP"
cp "$KEY_FILE" "$LOCAL_TMP/key"
chmod 600 "$LOCAL_TMP/key"
if ! ssh-keygen -y -f "$LOCAL_TMP/key" >/dev/null 2>&1; then
  echo "ERROR: OpenSSH refuses to use the key copy at $LOCAL_TMP/key (bad permissions)." >&2
  exit 1
fi
KEY_FILE="$LOCAL_TMP/key"

echo "    master: $MASTER_IP"
echo "    workers: ${WORKER_IPS[*]}"
echo "    key: $KEY_SRC"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes
          -o ConnectTimeout=10 -o LogLevel=ERROR
          -i "$KEY_FILE")
ssh_cmd=(ssh "${SSH_OPTS[@]}" "$SSH_USER@$MASTER_IP")
scp_cmd=(scp "${SSH_OPTS[@]}")

echo "==> 2/6 Waiting for SSH on the master"
for attempt in $(seq 1 30); do
  if "${ssh_cmd[@]}" true 2>/dev/null; then
    echo "    reachable after ${attempt} attempt(s)"
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "ERROR: cannot reach $MASTER_IP over SSH." >&2
    exit 1
  fi
  sleep 10
done

echo "==> 3/6 Installing Ansible on the master"
"${ssh_cmd[@]}" "sudo apt-get update -y && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ansible python3 && ansible --version | head -1"

echo "==> 4/6 Copying the configuration and installing collections"
REMOTE_HOME="$("${ssh_cmd[@]}" 'echo $HOME')"
REMOTE_DIR="$REMOTE_HOME/$REMOTE_SUBDIR"
"${ssh_cmd[@]}" "mkdir -p '$REMOTE_DIR' && chmod 700 '$REMOTE_DIR'"

cat > "$LOCAL_TMP/ansible.cfg" <<EOF
[defaults]
inventory = $REMOTE_DIR/hosts.ini
host_key_checking = False
ssh_known_hosts_check = False
retry_files_enabled = False
stdout_callback = yaml
interpreter_python = auto_silent
forks = 10
log_path = $REMOTE_DIR/ansible.log

[ssh_connection]
pipelining = True
ssh_args = -o ControlMaster=auto -o ControlPersist=60s -o StrictHostKeyChecking=accept-new
EOF

{
  echo "[workers]"
  i=1
  for ip in "${WORKER_IPS[@]}"; do
    printf 'worker-%02d ansible_host=%s\n' "$i" "$ip"
    i=$((i + 1))
  done
  echo
  echo "[workers:vars]"
  echo "ansible_user=$SSH_USER"
  echo "ansible_ssh_private_key_file=$REMOTE_DIR/key"
  echo "ansible_become=true"
} > "$LOCAL_TMP/hosts.ini"

if [ -n "$PUB_KEY" ]; then
  echo "ssh_public_key=$PUB_KEY" >> "$LOCAL_TMP/hosts.ini"
fi

cp "$DIR/docker.yml" "$LOCAL_TMP/docker.yml"
cp "$DIR/requirements.yml" "$LOCAL_TMP/requirements.yml"

"${scp_cmd[@]}" "$LOCAL_TMP/ansible.cfg" "$LOCAL_TMP/hosts.ini" "$LOCAL_TMP/docker.yml" "$LOCAL_TMP/requirements.yml" "$SSH_USER@$MASTER_IP:$REMOTE_DIR/"
"${scp_cmd[@]}" "$LOCAL_TMP/key" "$SSH_USER@$MASTER_IP:$REMOTE_DIR/key"
"${ssh_cmd[@]}" "chmod 600 '$REMOTE_DIR/key'"
"${ssh_cmd[@]}" "cd '$REMOTE_DIR' && ansible-galaxy collection install -r requirements.yml"

echo "==> 5/6 Verifying Ansible can reach the workers"
"${ssh_cmd[@]}" "cd '$REMOTE_DIR' && ansible all -m ping"

echo "==> 6/6 Done"

cat <<EOF

Ansible is configured on $MASTER_IP in $REMOTE_DIR.

  ssh $SSH_USER@$MASTER_IP
  cd $REMOTE_DIR && ansible-playbook docker.yml

Note: $REMOTE_DIR/key is a copy of your own private key, and the same
public key is installed on all three instances, so it can reach every node
from anywhere your /32 is allowed. Leave it if you will re-run the playbook;
otherwise remove it when you are done:

  ssh $SSH_USER@$MASTER_IP 'rm -f $REMOTE_DIR/key'

That breaks the playbook run above and nothing else. To restore it, either
re-run this script or scp the key back:

  scp ~/.ssh/<your-key> $SSH_USER@$MASTER_IP:$REMOTE_DIR/key
EOF
