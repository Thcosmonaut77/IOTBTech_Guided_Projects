#!/bin/sh
set -e

echo "Running database seed..."
attempt=1
max_attempts=10
until node dist/seed.js; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Seed failed after $max_attempts attempts" >&2
    exit 1
  fi
  echo "Seed attempt $attempt failed, retrying in 3s..."
  attempt=$((attempt + 1))
  sleep 3
done

exec "$@"