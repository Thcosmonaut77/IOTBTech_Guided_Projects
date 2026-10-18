#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# ZeetaFin deployment script
#
# All configuration is read from environment variables. Copy .env.example to
# .env, fill in real values, and run this script. The .env file is git-ignored
# and must never be committed.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${SCRIPT_DIR}/.env"
  set +a
fi

# --- Required secrets (fail fast when unset or empty) ----------------------
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required (set it in .env)}"
: "${JWT_SECRET:?JWT_SECRET is required (set it in .env)}"

# --- Database (non-secret defaults) ----------------------------------------
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-zeetafin}"

# --- Application ------------------------------------------------------------------
# Container ports are only published to BIND_ADDR so that the host's reverse
# proxy (nginx) is the sole entry point. Keep 127.0.0.1 in production.
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# --- Docker resources ------------------------------------------------------
NETWORK="${NETWORK:-zeetafin-net}"
DB_VOLUME="${DB_VOLUME:-zeetafin-pgdata}"
DB_IMAGE="${DB_IMAGE:-postgres:16-alpine}"
BE_IMAGE="${BE_IMAGE:-zeetafin-be:latest}"
FE_IMAGE="${FE_IMAGE:-zeetafin-fe:latest}"

DB_CONTAINER="${DB_CONTAINER:-zeetafin-db}"
BE_CONTAINER="${BE_CONTAINER:-zeetafin-be}"
FE_CONTAINER="${FE_CONTAINER:-zeetafin-fe}"

RESTART_POLICY="${RESTART_POLICY:-unless-stopped}"

# --- Deploy ----------------------------------------------------------------
docker network create "${NETWORK}" 2>/dev/null || true
docker volume create "${DB_VOLUME}" 2>/dev/null || true

docker rm -f "${DB_CONTAINER}" "${BE_CONTAINER}" "${FE_CONTAINER}" 2>/dev/null || true

docker run -d --name "${DB_CONTAINER}" --network "${NETWORK}" \
  --restart "${RESTART_POLICY}" \
  -e POSTGRES_USER="${POSTGRES_USER}" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -e POSTGRES_DB="${POSTGRES_DB}" \
  -v "${DB_VOLUME}:/var/lib/postgresql/data" \
  "${DB_IMAGE}"

echo "Waiting for database to become ready..."
for _ in $(seq 1 15); do
  docker exec "${DB_CONTAINER}" pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1 && break
  sleep 2
done

docker run -d --name "${BE_CONTAINER}" --network "${NETWORK}" \
  --restart "${RESTART_POLICY}" \
  -p "${BIND_ADDR}:${BACKEND_PORT}:3001" \
  -e NODE_ENV=production -e DB_HOST="${DB_CONTAINER}" -e DB_PORT=5432 \
  -e DB_USERNAME="${POSTGRES_USER}" -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
  -e DB_NAME="${POSTGRES_DB}" \
  -e JWT_SECRET="${JWT_SECRET}" -e PORT=3001 \
  "${BE_IMAGE}"

docker run -d --name "${FE_CONTAINER}" --network "${NETWORK}" \
  --restart "${RESTART_POLICY}" \
  -p "${BIND_ADDR}:${FRONTEND_PORT}:3000" \
  "${FE_IMAGE}"

echo "Deployed. Backend seeds automatically. Check with: docker logs ${BE_CONTAINER}"
