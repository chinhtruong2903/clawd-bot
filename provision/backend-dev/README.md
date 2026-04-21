# Backend Dev Docker Deploy

Manual deploy flow:

1. Build backend Docker image locally.
2. Push image to Docker Hub.
3. SSH to dev server.
4. Pull image with `docker-compose`.
5. Run backend directly on a public port, default `8600`.

This deploy pack does not touch nginx, router, domain, or any existing production compose stack.

## Files

- `docker-compose.yml`: runs the pushed backend image. It does not build source on the server.
- `compose.env.example`: compose variables such as image ref, host port, and runtime directory.
- `runtime.env.example`: backend runtime env loaded by the backend container as `.runtime.env`.
- `build-and-push.ps1`: local Windows script to build and push the backend image.
- `server-deploy.sh`: server script to pull and start the backend.

## Backend Dockerfile

The backend production Dockerfile is at:

```text
backend/Dockerfile
```

It includes Docker CLI because this backend manages OpenClaw containers through the host Docker socket.

## Local Build And Push

Login first:

```powershell
docker login
```

Build and push:

```powershell
powershell -ExecutionPolicy Bypass -File .\provision\backend-dev\build-and-push.ps1 -DockerHubUser <dockerhub-user> -Tag <tag>
```

Optional image name:

```powershell
powershell -ExecutionPolicy Bypass -File .\provision\backend-dev\build-and-push.ps1 -DockerHubUser <dockerhub-user> -ImageName clawbot-backend -Tag <tag>
```

Resulting image:

```text
<dockerhub-user>/clawbot-backend:<tag>
```

## Copy Deploy Files To Server

Create target directory:

```bash
ssh qkit@210.2.86.143 "mkdir -p /home/qkit/data/clawd-bot-backend-dev"
```

Copy files:

```bash
scp ./provision/backend-dev/docker-compose.yml ./provision/backend-dev/compose.env.example ./provision/backend-dev/runtime.env.example ./provision/backend-dev/server-deploy.sh qkit@210.2.86.143:/home/qkit/data/clawd-bot-backend-dev/
```

## Server Setup

SSH:

```bash
ssh qkit@210.2.86.143
```

Prepare env:

```bash
mkdir -p /home/qkit/data/clawd-bot-backend-dev
cd /home/qkit/data/clawd-bot-backend-dev
cp compose.env.example .env
cp runtime.env.example .runtime.env
chmod +x server-deploy.sh
```

Edit `.env`:

```bash
nano .env
```

Set at least:

```env
PROJECT_NAME=clawd-bot-backend-dev
IMAGE_REF=<dockerhub-user>/clawbot-backend:<tag>
HOST_PORT=8600
CONTAINER_PORT=5000
HOST_RUNTIME_DIR=/home/qkit/data/clawd-bot-backend-dev/runtime
OPENCLAW_IMAGE=<dockerhub-user>/clawd-bot-openclaw:dev
```

If the backend image is private, add:

```env
DOCKERHUB_USERNAME=<dockerhub-user>
DOCKERHUB_TOKEN=<dockerhub-access-token>
```

Edit `.runtime.env`:

```bash
nano .runtime.env
```

Set a strong token/password:

```env
NODE_ENV=production
PANEL_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
OPENCLAW_GATEWAY_TOKEN=change-me-dev-token
TZ=Asia/Saigon
ROOT_PASSWORD=change-me-root-password
```

Deploy:

```bash
sh server-deploy.sh
```

The script detects either:

- `docker compose`
- `docker-compose`

It then runs:

```bash
docker-compose pull
docker-compose up -d --remove-orphans
docker-compose ps
```

or the equivalent `docker compose` command.

## Verify

Compose status:

```bash
docker-compose -p clawd-bot-backend-dev ps
```

Containers:

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

Swagger:

```bash
curl -I http://localhost:8600/api/docs
```

Public URL:

```text
http://210.2.86.143:8600/api/docs
```

## OpenClaw Runtime Image

This backend can create many OpenClaw containers, but the server must be able to pull or already have the OpenClaw runtime image defined by:

```env
OPENCLAW_IMAGE=<dockerhub-user>/clawd-bot-openclaw:dev
```

If the image is absent, the backend tries:

```bash
docker pull "$OPENCLAW_IMAGE"
```

If pull fails, it falls back to building from `CLAWBOT_ROOT`. For this dev deploy, prefer setting `OPENCLAW_IMAGE` to a pushed Docker Hub image.

## Private Docker Hub Image

If image is private, put these in `.env`:

```env
DOCKERHUB_USERNAME=<dockerhub-user>
DOCKERHUB_TOKEN=<dockerhub-access-token>
```

`server-deploy.sh` will run:

```bash
echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
```

## Pull Timeout Fallback

If Docker Hub pull times out, retry manually:

```bash
docker pull <dockerhub-user>/clawbot-backend:<tag>
sh server-deploy.sh
```

Fallback with image tar:

Local:

```powershell
docker save <dockerhub-user>/clawbot-backend:<tag> -o clawbot-backend.tar
scp .\clawbot-backend.tar qkit@210.2.86.143:/home/qkit/data/clawd-bot-backend-dev/
```

Server:

```bash
cd /home/qkit/data/clawd-bot-backend-dev
docker load -i clawbot-backend.tar
sh server-deploy.sh
```

## Optional Dev Postgres

Current backend does not require Postgres. If a future backend env requires DB, add a separate Postgres service and a dev-only volume. Do not reuse production DB.

Suggested volume name:

```text
clawd-bot-backend-dev-postgres-data
```

## Copy Data From Old Postgres If Needed

Dump old DB in custom format:

```bash
docker exec <old-postgres-container> sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /root/prod.dump
```

Copy dump to dev server:

```bash
scp prod.dump qkit@210.2.86.143:/home/qkit/data/clawd-bot-backend-dev/
```

Restore into new dev DB container:

```bash
docker cp prod.dump <new-db-container>:/tmp/prod.dump
docker exec <new-db-container> sh -lc 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/prod.dump'
```
