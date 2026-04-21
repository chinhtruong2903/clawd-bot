$env:NEXT_PUBLIC_API_BASE_URL = if ($env:NEXT_PUBLIC_API_BASE_URL) { $env:NEXT_PUBLIC_API_BASE_URL } else { "http://127.0.0.1:3001" }

npx next dev --hostname 127.0.0.1 --port 3000 *> frontend-server.log
