# Spotify Karaoke Trivia Worker

Minimal TypeScript Worker with a Workers AI binding named `AI`.
The existing trivia and playlist files are preserved; they are not yet wired into an application.

## Run locally

Use Node.js 22 or newer and a Cloudflare account on the **Workers Free plan**.

```powershell
npm install
npx wrangler login
npm run dev
```

`GET /health` checks the Worker without making an AI call.
Send an AI request from another PowerShell terminal:

```powershell
Invoke-RestMethod -Uri http://localhost:8787/api/ai -Method Post -ContentType 'application/json' -Body '{"prompt":"Write one short 1980s music trivia question with its answer."}'
```

The model is fixed to `@cf/openai/gpt-oss-20b`, eligible for the free allocation.
For development, input is limited to 20,000 characters; output is limited to 4,000 tokens.
The JSON request body is capped at 128 KiB to accommodate encoding and escaping.
We will measure actual Workers AI usage before optimizing prompt size.
Local AI calls use Cloudflare's hosted service and share the account's daily allowance with deployed calls.

Cloudflare currently includes 10,000 Neurons daily, resetting at 00:00 UTC. On Workers Free, requests fail after the allowance is exhausted. On Workers Paid, excess usage can incur charges. This configuration does not change your account plan or impose an account-wide spending cap. Keep the account on Workers Free to avoid usage overages. Some other models require paid billing; clients cannot override this starter's model.

See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [development documentation](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/).

## Validate and deploy

```powershell
npm run cf-typegen
npm run check
npm run build
# Publishes the Worker to Cloudflare:
npm run deploy
```

This starter's AI endpoint has no authentication. Before publishing for general use, add access controls and rate limits so visitors cannot consume the shared allowance. No deployment is required for local development.
