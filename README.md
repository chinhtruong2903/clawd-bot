# Local OpenClaw Docker

Ubuntu-based container for testing an OpenClaw Gateway locally before moving it to a server.

## Run

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

The Gateway will be available at:

- Control/API: `http://127.0.0.1:18789`
- SSH: `ssh root@127.0.0.1 -p 2222`

Default local values are in `.env.example`. Change `OPENCLAW_GATEWAY_TOKEN` and `ROOT_PASSWORD` before using this outside local development.

## Health Check

```powershell
curl.exe http://127.0.0.1:18789/healthz
curl.exe http://127.0.0.1:18789/readyz
```

## API Check

```powershell
curl.exe http://127.0.0.1:18789/v1/models `
  -H "Authorization: Bearer local-dev-token-change-me"
```

PowerShell JSON example:

```powershell
$body = @{
  model = "openclaw"
  input = "hi"
  max_output_tokens = 64
} | ConvertTo-Json -Compress

Invoke-WebRequest `
  -Uri "http://127.0.0.1:18789/v1/responses" `
  -Method Post `
  -Headers @{ Authorization = "Bearer local-dev-token-change-me" } `
  -ContentType "application/json" `
  -Body $body
```

Real model responses require Codex Auth. Run the onboarding process manually inside the container to open the login link and authorize:

```powershell
docker exec -u openclaw -it openclaw-local openclaw onboard
```

## Useful Commands

```powershell
docker compose ps
docker compose logs -f openclaw
docker compose down
```
