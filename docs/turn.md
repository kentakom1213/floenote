# TURN relay

The official Floe Note client uses Cloudflare Realtime TURN automatically when
direct WebRTC connectivity fails. The coordinator issues temporary ICE
credentials; it never receives WorkspaceKeys or note/CRDT content. The data
path remains `Loro update → WorkspaceKey encryption → WebRTC DataChannel →
direct connection or TURN relay`. TURN relays already application-encrypted
traffic and is neither Workspace authorization nor offline storage.

## Connection behavior

- Normal synchronization tries direct STUN/WebRTC first. If the existing
  six-second direct attempt does not connect, the initiating device creates a
  new signaling session and both devices request or reuse TURN credentials for
  a relay-only `RTCPeerConnection` (`iceTransportPolicy: "relay"`). Failed
  relay issuance returns to the existing reconnect backoff and leaves local
  editing, Workspace access, and SecurityState intact.
- Initial invitation pairing asks for TURN during its initial WebRTC setup so
  direct and relay candidates can be available together. The host uses its
  authenticated Presence socket; the joiner uses `InviteId + ClaimId` only
  after a successful claim. `PairingSecret` remains in the invitation URL
  fragment and peer authentication, never in the coordinator TURN request.

The coordinator calls Cloudflare's
[`generate-ice-servers` API](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
with a 24-hour (`86_400` second) TTL and returns only `iceServers` and an
`expiresAt` timestamp. The client caches credentials in memory until one
minute before expiry and obtains new ones on the next relay attempt. It does
not persist them or refresh a live peer connection. A revoked device cannot
obtain new credentials, although credentials issued earlier may remain usable
as transport capabilities until they expire. They do not restore Workspace
authorization or WorkspaceKey access.

## Coordinator configuration

The official coordinator uses these runtime values in every environment:

- `TURN_ENABLED`: set to `true` to issue credentials; absent or `false` is the
  operational kill switch for new issuance.
- `TURN_KEY_ID`: Cloudflare Realtime TURN key ID.
- `TURN_KEY_API_TOKEN`: server-side Cloudflare TURN API token.

Configure them as coordinator Worker secrets, for example with
`pnpm --filter @floe-note/coordinator exec wrangler secret put <NAME>`.
Create a separate Cloudflare TURN key for production and for any controlled
TURN-enabled staging coordinator. Keep both long-lived values out of the web
build, source control, and ordinary PR previews. Production and staging can
then be disabled or rotated independently. Ordinary PR previews explicitly set
`TURN_ENABLED=false` and require no TURN secrets. If the key or token is
missing, credential requests fail cleanly even when TURN is enabled.

The coordinator uses Cloudflare Workers rate-limit bindings as coarse abuse
brakes: `TURN_DEVICE_RATE_LIMIT` allows 5 issuance requests per minute per
`DeviceId`, and `TURN_INVITE_RATE_LIMIT` allows 3 per minute per `InviteId`.
Cloudflare applies these counters per location and approximately, so they are
not quotas. Issuance includes only a non-content `customIdentifier`:
`device:<DeviceId>` or `invite:<InviteId>`, for Cloudflare TURN analytics.
Credentials, usernames, passwords, and long-lived secrets are never logged.

## Development compatibility

`apps/turn` remains for development and self-host compatibility. Its
`TURN_ACCESS_TOKEN` capability URL is not the official production client path.
Development builds can still configure that endpoint in Settings → Network;
production builds use coordinator issuance without a manual endpoint. New
deployments should prefer the coordinator flow rather than distributing a
shared endpoint URL.
