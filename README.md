# temporaltrial — Tekno release Temporal worker
# TypeScript worker that polls tekno-release-task-queue on your Railway Temporal.

## Local dev
```powershell
npm ci
npm run build
$env:TEMPORAL_ADDRESS="turntable.proxy.rlwy.net:51514"
npm start                      # worker
npm run client                 # start one release (sends approval after 10s)
```

## Deploy to Railway (magnificent-cooperation / Worker)
1. Push this repo to GitHub (`jardaKarlik/temporaltrial`).
2. Railway → magnificent-cooperation → Worker → Settings → Source → connect repo `jardaKarlik/temporaltrial`, root `/`.
   Build: `npm ci && npm run build`, start: `npm start`.
3. Worker variables (Railway dashboard):
   - `TEMPORAL_ADDRESS=temporal.railway.internal:7233`
   - `RELEASES_PROJECT_ID=ce27c333-68c0-4d53-a139-1688261d3452`
   - `RELEASES_ENV=production`
   - `RELEASES_STAGING_SERVICE_ID=39ab8724-a7a5-4162-b585-cb7779194bf3`
   - `RELEASES_PROD_SERVICE_ID=<same or second service id>`
   - `TEKNO_STAGING_URL=https://tekno.up.railway.app`
   - `TEKNO_PROD_URL=https://tekno.up.railway.app`
   - `DISCORD_WEBHOOK_URL=<secret, incidents webhook>`
   - `RAILWAY_TOKEN=<Railway account/project token, secret>`
4. Deploy. Worker polls `tekno-release-task-queue` — the “No workers polling” alert disappears.

## About that Temporal Cloud screenshot
The Name/Build ID/AWS Lambda form is **Temporal Cloud Nexus / worker-deployment** config — it only supports AWS Lambda (GCP “coming soon”). You don’t need it: ignore that screen entirely. Our worker runs on Railway and connects to your self-hosted Temporal at `temporal.railway.internal:7233`.
