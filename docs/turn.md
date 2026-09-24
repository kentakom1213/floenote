# TURN relay setup

Floe Note prefers direct WebRTC connections. An optional Cloudflare Realtime
TURN credential endpoint can be configured per device to provide relay
candidates when direct ICE connectivity is unavailable.

The TURN service is not shared by Floe Note. Each deployment uses its own
Cloudflare TURN key and Worker.

## 1. Create a Cloudflare TURN key

Create a Realtime TURN key in the Cloudflare dashboard and keep its key ID and
API token. The long-lived TURN key must stay server-side; do not put it in the
Floe web app.

## 2. Configure the credential Worker

The Worker in `apps/turn` needs three secrets:

- `TURN_KEY_ID`: Cloudflare Realtime TURN key ID.
- `TURN_KEY_API_TOKEN`: API token for that TURN key.
- `TURN_ACCESS_TOKEN`: a random capability token that protects the public
  credential endpoint.

For local development, copy `apps/turn/.dev.vars.example` to
`apps/turn/.dev.vars` and replace the placeholder values.

For a deployed Worker, set the secrets with Wrangler:

```sh
pnpm --filter @floe-note/turn exec wrangler secret put TURN_KEY_ID
pnpm --filter @floe-note/turn exec wrangler secret put TURN_KEY_API_TOKEN
pnpm --filter @floe-note/turn exec wrangler secret put TURN_ACCESS_TOKEN
```

A random access token can be generated with, for example:

```sh
openssl rand -hex 32
```

## 3. Run or deploy

Local development:

```sh
pnpm dev:turn
```

Deployment:

```sh
pnpm deploy:turn
```

The Worker exposes credentials at:

```text
https://<worker-host>/credentials/<TURN_ACCESS_TOKEN>
```

Treat the complete URL as a secret. The Worker exchanges its long-lived
Cloudflare TURN key for short-lived ICE credentials and never sends the
long-lived key to the browser.

## 4. Configure Floe Note

Open Settings -> Network and paste the complete URL into
`TURN credential endpoint`. Use `Test` to verify that short-lived TURN
credentials can be fetched, then save it.

The endpoint is stored only on that browser/device and is shared by all Floe
Projects on the device. It is not synchronized to other devices.

If the setting is absent, or if credential retrieval fails, Floe continues with
its default STUN-only WebRTC configuration. When TURN credentials are
available, both direct and relay ICE candidates are supplied to WebRTC; ICE
still prefers a working direct path and uses the relay only when necessary.
