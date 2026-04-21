$env:PORT = if ($env:PORT) { $env:PORT } else { "3001" }
$env:OPENCLAW_BASE_URL = if ($env:OPENCLAW_BASE_URL) { $env:OPENCLAW_BASE_URL } else { "http://127.0.0.1:18789" }

npm run start *> backend-server.log
