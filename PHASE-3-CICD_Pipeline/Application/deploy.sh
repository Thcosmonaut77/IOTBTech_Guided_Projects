#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# ZeetaFin on-host deploy script (Phase 3)
#
# Runs ON the EC2 host. It logs in to ECR with the instance role, pulls the
# commit-tagged images produced by GitHub Actions, starts them in the inactive
# colour slot, proves both answer, then switches nginx with an atomic reload.
# The previous colour keeps serving until the new one is healthy.
#
#   AWS_REGION=... ECR_REGISTRY=... ECR_REPOSITORY=... IMAGE_TAG=<sha> bash deploy.sh
#   ... bash deploy.sh --rollback     # redeploy .last_good_tag
#
# The PostgreSQL container and its named volume are started only if missing:
# a deploy never recreates the database. Configuration comes from .env, which
# is generated once by setup-docker.sh and preserved across deploys.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${SCRIPT_DIR}/.env"
  set +a
fi

MODE="deploy"
if [[ "${1:-}" == "--rollback" ]]; then
  MODE="rollback"
fi

ACTIVE_COLOR_FILE="${SCRIPT_DIR}/.active_color"
DEPLOYED_TAG_FILE="${SCRIPT_DIR}/.deployed_tag"
PREVIOUS_TAG_FILE="${SCRIPT_DIR}/.previous_tag"
LAST_GOOD_TAG_FILE="${SCRIPT_DIR}/.last_good_tag"

if [[ "$MODE" == "rollback" ]]; then
  if [[ -s "$LAST_GOOD_TAG_FILE" ]]; then
    IMAGE_TAG="$(cat "$LAST_GOOD_TAG_FILE")"
  elif [[ -s "$PREVIOUS_TAG_FILE" ]]; then
    IMAGE_TAG="$(cat "$PREVIOUS_TAG_FILE")"
  else
    echo "ERROR: no last known-good or previous tag to roll back to" >&2
    exit 1
  fi
  echo "Rolling back to ${IMAGE_TAG}"
fi

# --- Required secrets (fail fast when unset or empty) ----------------------
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required (set it in .env)}"
: "${JWT_SECRET:?JWT_SECRET is required (set it in .env)}"

# --- Registry and image selection ------------------------------------------
: "${ECR_REGISTRY:?ECR_REGISTRY is required (set by the pipeline)}"
: "${ECR_REPOSITORY:?ECR_REPOSITORY is required (set by the pipeline)}"
: "${IMAGE_TAG:?IMAGE_TAG is required (set by the pipeline)}"

AWS_REGION="${AWS_REGION:-eu-north-1}"

BE_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY}:backend-${IMAGE_TAG}"
FE_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY}:frontend-${IMAGE_TAG}"

# --- Database (non-secret defaults) ----------------------------------------
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-zeetafin}"

# --- Networking ------------------------------------------------------------
# Container ports are published only to BIND_ADDR so the host's reverse proxy
# (nginx) is the sole entry point. Keep 127.0.0.1 in production. Blue and green
# use different ports; nginx decides which pair receives traffic.
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
BLUE_BACKEND_PORT="${BLUE_BACKEND_PORT:-3001}"
BLUE_FRONTEND_PORT="${BLUE_FRONTEND_PORT:-3000}"
GREEN_BACKEND_PORT="${GREEN_BACKEND_PORT:-3002}"
GREEN_FRONTEND_PORT="${GREEN_FRONTEND_PORT:-3003}"

# --- Docker resources ------------------------------------------------------
NETWORK="${NETWORK:-zeetafin-net}"
DB_VOLUME="${DB_VOLUME:-zeetafin-pgdata}"
DB_IMAGE="${DB_IMAGE:-postgres:16-alpine}"

DB_CONTAINER="${DB_CONTAINER:-zeetafin-db}"
BE_CONTAINER="${BE_CONTAINER:-zeetafin-be}"
FE_CONTAINER="${FE_CONTAINER:-zeetafin-fe}"
LEGACY_BE_CONTAINER="${LEGACY_BE_CONTAINER:-zeetafin-be}"
LEGACY_FE_CONTAINER="${LEGACY_FE_CONTAINER:-zeetafin-fe}"

RESTART_POLICY="${RESTART_POLICY:-unless-stopped}"

# --- nginx -----------------------------------------------------------------
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/zeetafin}"
NGINX_UPSTREAMS="${NGINX_UPSTREAMS:-/etc/nginx/zeetafin-upstreams.conf}"

SUDO=(sudo)
if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
elif ! command -v sudo >/dev/null 2>&1; then
  echo "ERROR: nginx changes need root or sudo" >&2
  exit 1
fi

# The bootstrap adds the login user to the docker group, but a session that
# predates that change will not have it. Fall back to sudo rather than failing.
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
fi

# --- Helpers ---------------------------------------------------------------
render_upstreams() {
  local color="$1" backend_port frontend_port
  case "$color" in
    blue)
      backend_port="$BLUE_BACKEND_PORT"
      frontend_port="$BLUE_FRONTEND_PORT"
      ;;
    green)
      backend_port="$GREEN_BACKEND_PORT"
      frontend_port="$GREEN_FRONTEND_PORT"
      ;;
    *)
      echo "ERROR: unknown colour '$color'" >&2
      return 1
      ;;
  esac

  printf 'upstream zeetafin_backend {\n    server 127.0.0.1:%s;\n}\n\n' "$backend_port"
  printf 'upstream zeetafin_frontend {\n    server 127.0.0.1:%s;\n}\n' "$frontend_port"
}

write_upstreams() {
  local color="$1" tmp
  tmp="$(mktemp)"
  render_upstreams "$color" > "$tmp"
  "${SUDO[@]}" install -m 644 "$tmp" "${NGINX_UPSTREAMS}.new"
  "${SUDO[@]}" mv "${NGINX_UPSTREAMS}.new" "$NGINX_UPSTREAMS"
  rm -f "$tmp"
}

reload_nginx() {
  "${SUDO[@]}" nginx -t
  "${SUDO[@]}" systemctl reload nginx
}

ensure_nginx_uses_upstreams() {
  if [[ ! -f "$NGINX_SITE" ]]; then
    echo "ERROR: nginx site ${NGINX_SITE} is missing; re-run setup-docker.sh" >&2
    return 1
  fi

  # Older hosts proxy directly to fixed ports. Patch them once, preserving the
  # certbot-managed TLS blocks, so the colour switch has a single switch point.
  if ! "${SUDO[@]}" grep -q 'zeetafin-upstreams.conf' "$NGINX_SITE"; then
    local tmp
    tmp="$(mktemp)"
    "${SUDO[@]}" cat "$NGINX_SITE" \
      | sed -e 's#proxy_pass http://127\.0\.0\.1:3001;#proxy_pass http://zeetafin_backend;#' \
            -e 's#proxy_pass http://127\.0\.0\.1:3000;#proxy_pass http://zeetafin_frontend;#' \
      > "$tmp"
    {
      printf 'include %s;\n\n' "$NGINX_UPSTREAMS"
      cat "$tmp"
    } > "${tmp}.new"
    "${SUDO[@]}" install -m 644 "${tmp}.new" "$NGINX_SITE"
    rm -f "$tmp" "${tmp}.new"
    echo "Migrated ${NGINX_SITE} to the blue/green upstream include"
  fi

  if [[ ! -f "$NGINX_UPSTREAMS" ]]; then
    write_upstreams "${active_color:-blue}"
  fi
}

wait_for_url() {
  local name="$1" url="$2" attempts="$3" delay="$4" i
  for i in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "${name} is up"
      return 0
    fi
    sleep "$delay"
  done
  echo "ERROR: ${name} did not become ready at ${url}" >&2
  return 1
}

remove_containers() {
  "${DOCKER[@]}" rm -f "$@" >/dev/null 2>&1 || true
}

# --- Read the current slot --------------------------------------------------
active_color=""
legacy_active=0
if [[ -s "$ACTIVE_COLOR_FILE" ]]; then
  active_color="$(cat "$ACTIVE_COLOR_FILE")"
  if [[ "$active_color" != "blue" && "$active_color" != "green" ]]; then
    echo "ERROR: invalid colour in ${ACTIVE_COLOR_FILE}: ${active_color}" >&2
    exit 1
  fi
elif "${DOCKER[@]}" inspect "$LEGACY_BE_CONTAINER" >/dev/null 2>&1 \
  || "${DOCKER[@]}" inspect "$LEGACY_FE_CONTAINER" >/dev/null 2>&1; then
  # First run after the pre-blue/green layout: the unsuffixed containers own
  # the blue ports.
  active_color="blue"
  legacy_active=1
fi

if [[ -z "$active_color" ]]; then
  new_color="blue"
elif [[ "$active_color" == "blue" ]]; then
  new_color="green"
else
  new_color="blue"
fi

case "$new_color" in
  blue)
    new_backend_port="$BLUE_BACKEND_PORT"
    new_frontend_port="$BLUE_FRONTEND_PORT"
    ;;
  green)
    new_backend_port="$GREEN_BACKEND_PORT"
    new_frontend_port="$GREEN_FRONTEND_PORT"
    ;;
esac

new_be_container="${BE_CONTAINER}-${new_color}"
new_fe_container="${FE_CONTAINER}-${new_color}"

old_be_container=""
old_fe_container=""
if [[ -n "$active_color" ]]; then
  if [[ "$legacy_active" -eq 1 ]]; then
    old_be_container="$LEGACY_BE_CONTAINER"
    old_fe_container="$LEGACY_FE_CONTAINER"
  else
    old_be_container="${BE_CONTAINER}-${active_color}"
    old_fe_container="${FE_CONTAINER}-${active_color}"
  fi
fi

# Remember what was live before this deploy, unless this is already a rollback.
if [[ "$MODE" == "deploy" && -s "$DEPLOYED_TAG_FILE" ]]; then
  deployed_tag="$(cat "$DEPLOYED_TAG_FILE")"
  if [[ "$deployed_tag" != "$IMAGE_TAG" ]]; then
    printf '%s\n' "$deployed_tag" > "$PREVIOUS_TAG_FILE"
  fi
fi

# --- ECR authentication ----------------------------------------------------
# On EC2 this uses the instance profile. No long-lived AWS keys on the host.
echo "Logging in to ECR registry ${ECR_REGISTRY} (${AWS_REGION})..."
aws ecr get-login-password --region "${AWS_REGION}" \
  | "${DOCKER[@]}" login --username AWS --password-stdin "${ECR_REGISTRY}"

# --- Pull before touching the live colour ----------------------------------
echo "Pulling ${BE_IMAGE}"
"${DOCKER[@]}" pull "${BE_IMAGE}"
echo "Pulling ${FE_IMAGE}"
"${DOCKER[@]}" pull "${FE_IMAGE}"

# --- Network and database --------------------------------------------------
"${DOCKER[@]}" network create "${NETWORK}" 2>/dev/null || true
"${DOCKER[@]}" volume create "${DB_VOLUME}" 2>/dev/null || true

if "${DOCKER[@]}" inspect "${DB_CONTAINER}" >/dev/null 2>&1; then
  echo "Keeping existing database container ${DB_CONTAINER}"
  "${DOCKER[@]}" start "${DB_CONTAINER}" >/dev/null 2>&1 || true
else
  echo "Creating database container ${DB_CONTAINER}"
  "${DOCKER[@]}" run -d --name "${DB_CONTAINER}" --network "${NETWORK}" \
    --restart "${RESTART_POLICY}" \
    -e POSTGRES_USER="${POSTGRES_USER}" \
    -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
    -e POSTGRES_DB="${POSTGRES_DB}" \
    -v "${DB_VOLUME}:/var/lib/postgresql/data" \
    "${DB_IMAGE}"
fi

echo "Waiting for database to become ready..."
for _ in $(seq 1 30); do
  "${DOCKER[@]}" exec "${DB_CONTAINER}" pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1 && break
  sleep 2
done
if ! "${DOCKER[@]}" exec "${DB_CONTAINER}" pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
  echo "ERROR: database did not become ready" >&2
  "${DOCKER[@]}" logs "${DB_CONTAINER}" --tail 40 >&2 || true
  exit 1
fi

# --- Start the inactive colour ---------------------------------------------
# Any stale container with the target name is removed first. The live colour is
# untouched, so a failure here leaves the previous version serving.
remove_containers "$new_be_container" "$new_fe_container"

echo "Starting ${new_color} on backend ${new_backend_port} and frontend ${new_frontend_port}"
"${DOCKER[@]}" run -d --name "${new_be_container}" --network "${NETWORK}" \
  --restart "${RESTART_POLICY}" \
  --label "com.zeetafin.color=${new_color}" \
  --label "com.zeetafin.tag=${IMAGE_TAG}" \
  -p "${BIND_ADDR}:${new_backend_port}:3001" \
  -e NODE_ENV=production -e DB_HOST="${DB_CONTAINER}" -e DB_PORT=5432 \
  -e DB_USERNAME="${POSTGRES_USER}" -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
  -e DB_NAME="${POSTGRES_DB}" \
  -e JWT_SECRET="${JWT_SECRET}" -e PORT=3001 \
  "${BE_IMAGE}"

"${DOCKER[@]}" run -d --name "${new_fe_container}" --network "${NETWORK}" \
  --restart "${RESTART_POLICY}" \
  --label "com.zeetafin.color=${new_color}" \
  --label "com.zeetafin.tag=${IMAGE_TAG}" \
  -p "${BIND_ADDR}:${new_frontend_port}:3000" \
  "${FE_IMAGE}"

if ! wait_for_url "API" "http://127.0.0.1:${new_backend_port}/api/docs" 30 5; then
  "${DOCKER[@]}" logs "${new_be_container}" --tail 60 >&2 || true
  remove_containers "$new_be_container" "$new_fe_container"
  exit 1
fi

if ! wait_for_url "frontend" "http://127.0.0.1:${new_frontend_port}/" 30 3; then
  "${DOCKER[@]}" logs "${new_fe_container}" --tail 60 >&2 || true
  remove_containers "$new_be_container" "$new_fe_container"
  exit 1
fi

# --- Switch nginx ----------------------------------------------------------
ensure_nginx_uses_upstreams

previous_upstreams="$(mktemp)"
if [[ -f "$NGINX_UPSTREAMS" ]]; then
  "${SUDO[@]}" cat "$NGINX_UPSTREAMS" > "$previous_upstreams"
fi

restore_upstreams() {
  if [[ -s "$previous_upstreams" ]]; then
    "${SUDO[@]}" install -m 644 "$previous_upstreams" "$NGINX_UPSTREAMS"
    reload_nginx || true
  fi
  rm -f "$previous_upstreams"
}

echo "Switching nginx to ${new_color}"
if ! write_upstreams "$new_color"; then
  restore_upstreams
  remove_containers "$new_be_container" "$new_fe_container"
  exit 1
fi
if ! reload_nginx; then
  echo "ERROR: nginx rejected the ${new_color} upstreams; keeping ${active_color:-no active colour}" >&2
  restore_upstreams
  remove_containers "$new_be_container" "$new_fe_container"
  exit 1
fi
rm -f "$previous_upstreams"

# --- Commit the slot and remove the old colour -----------------------------
printf '%s\n' "$new_color" > "$ACTIVE_COLOR_FILE"
printf '%s\n' "$IMAGE_TAG" > "$DEPLOYED_TAG_FILE"

if [[ -n "$old_be_container" ]]; then
  echo "Removing previous ${active_color} containers"
  remove_containers "$old_be_container" "$old_fe_container"
fi

echo "Removing dangling images..."
"${DOCKER[@]}" image prune -f >/dev/null 2>&1 || true

"${DOCKER[@]}" ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo "Deployed ${IMAGE_TAG} on ${new_color}."
