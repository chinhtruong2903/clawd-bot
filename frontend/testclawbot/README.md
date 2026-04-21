# Clawbot Frontend

Next.js frontend for managing Clawbot/OpenClaw instances through the NestJS backend.

## Local Env

Copy the example:

```bash
cp .env.local.example .env.local
```

Default local values:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001
NEXT_PUBLIC_SSH_HOST_LABEL=127.0.0.1
```

## Run Locally

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Vercel Env

Set these Environment Variables in Vercel:

```env
BACKEND_ORIGIN=http://210.2.86.143:8620
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_SSH_HOST_LABEL=210.2.86.143
```

`BACKEND_ORIGIN` is used by Next.js rewrites on Vercel. The browser calls the Vercel HTTPS origin, and Vercel proxies `/api/*` and `/socket.io/*` to the HTTP backend.

Leave `NEXT_PUBLIC_API_BASE_URL` empty in Vercel so the browser uses same-origin paths such as `/api/instances`.

`NEXT_PUBLIC_SSH_HOST_LABEL` is only a display label for instance SSH port hints.

## HTTP Backend Behind Vercel

The backend can remain on HTTP because Vercel rewrites run server-side:

- Browser -> `https://your-vercel-app.vercel.app/api/...`
- Vercel -> `http://210.2.86.143:8620/api/...`

Socket.IO traffic is also proxied through `/socket.io/*`.

## Vercel Settings

Use:

```text
Framework Preset: Next.js
Root Directory: frontend/testclawbot
Build Command: npm run build
Install Command: npm install
Output Directory: .next
```

After changing `NEXT_PUBLIC_*` variables in Vercel, redeploy the frontend because these values are baked into the client bundle at build time.
