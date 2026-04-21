#!/usr/bin/env sh
set -eu

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

PROJECT_NAME="${PROJECT_NAME:-clawd-bot-backend-dev}"
HOST_RUNTIME_DIR="${HOST_RUNTIME_DIR:-/home/qkit/data/clawd-bot-backend-dev/runtime}"

if docker compose version >/dev/null 2>&1; then
  compose() {
    docker compose -p "$PROJECT_NAME" "$@"
  }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() {
    docker-compose -p "$PROJECT_NAME" "$@"
  }
else
  echo "Neither docker compose nor docker-compose was found." >&2
  exit 1
fi

mkdir -p "$HOST_RUNTIME_DIR/workspace"

if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  echo "Logging in to Docker Hub as $DOCKERHUB_USERNAME"
  echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
fi

echo "Pulling images..."
attempt=1
until compose pull; do
  if [ "$attempt" -ge 3 ]; then
    echo "docker compose pull failed after $attempt attempts." >&2
    echo "Fallback option: docker save locally, scp the tar, docker load on server, then rerun this script." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "Pull failed. Retrying attempt $attempt/3 in 5 seconds..."
  sleep 5
done

echo "Starting backend..."
compose up -d --remove-orphans

echo "Compose status:"
compose ps
