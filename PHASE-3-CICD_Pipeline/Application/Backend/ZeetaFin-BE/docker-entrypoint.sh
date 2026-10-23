#!/bin/sh
set -e

run_with_retries() {
  label="$1"
  shift
  attempt=1
  max_attempts=10
  until "$@"; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "$label failed after $max_attempts attempts" >&2
      exit 1
    fi
    echo "$label attempt $attempt failed, retrying in 3s..."
    attempt=$((attempt + 1))
    sleep 3
  done
}

echo "Running database migrations..."
run_with_retries "Migration" node dist/migrate.js

echo "Running database seed..."
run_with_retries "Seed" node dist/seed.js

exec "$@"
