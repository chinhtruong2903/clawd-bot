#!/usr/bin/env bash
set -euo pipefail

ROOT_PASSWORD="${ROOT_PASSWORD:-root@123}"
OPENCLAW_GATEWAY_BIND="${OPENCLAW_GATEWAY_BIND:-lan}"
OPENCLAW_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
OPENCLAW_ENABLE_RESPONSES_API="${OPENCLAW_ENABLE_RESPONSES_API:-true}"

case "$(printf '%s' "${OPENCLAW_ENABLE_RESPONSES_API}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
        responses_api_enabled=true
        ;;
    *)
        responses_api_enabled=false
        ;;
esac

echo "root:${ROOT_PASSWORD}" | chpasswd

mkdir -p /var/run/sshd /home/openclaw/.openclaw /workspace
chown -R openclaw:openclaw /home/openclaw/.openclaw /workspace

/usr/sbin/sshd

if [[ "${1:-}" != "openclaw-gateway" ]]; then
    exec "$@"
fi

config_json='[
  {"path":"gateway.mode","value":"local"},
  {"path":"gateway.bind","value":"'"${OPENCLAW_GATEWAY_BIND}"'"},
  {"path":"gateway.http.endpoints.responses.enabled","value":'"${responses_api_enabled}"'}
]'

runuser -u openclaw -- env \
    HOME=/home/openclaw \
    OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}" \
    openclaw config set --batch-json "${config_json}" >/dev/null || true

exec runuser -u openclaw -- env \
    HOME=/home/openclaw \
    TERM="${TERM:-xterm-256color}" \
    TZ="${TZ:-UTC}" \
    OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}" \
    OPENCLAW_GATEWAY_PASSWORD="${OPENCLAW_GATEWAY_PASSWORD:-}" \
    openclaw gateway \
        --bind "${OPENCLAW_GATEWAY_BIND}" \
        --port "${OPENCLAW_GATEWAY_PORT}" \
        --allow-unconfigured
