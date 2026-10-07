# Floe Note

Local-first, end-to-end encrypted Markdown notes that sync across your devices.

[English](README.md) | [日本語](README-ja.md)

**Floe Note is experimental software under active development.** Do not rely on it as the only copy of irreplaceable data. Its security architecture has not received an independent security audit.

[Try Floe Note](https://floe.pwll.dev)

## About

Floe Note is a privacy-oriented, local-first note application for one person using multiple devices.

Its core model is intentionally simple:

- notes remain available locally and can be edited offline;
- authorized devices synchronize Workspace data over WebRTC;
- direct peer-to-peer connections are preferred, with TURN relay fallback when direct connectivity fails;
- Cloudflare is used for rendezvous, signaling, invitations, and security-state coordination, not for storing note contents;
- concurrent edits are merged with [Loro](https://www.loro.dev/) CRDTs;
- persistent Workspace data is encrypted at rest and in transit at the application layer.

A **Workspace** is the synchronization, authorization, and cryptographic boundary. **Projects** are lightweight organization units inside a Workspace and do not create separate security boundaries.

## Features

- Local-first Markdown editing with offline access
- End-to-end encrypted multi-device synchronization
- Direct WebRTC synchronization with automatic TURN relay fallback
- Device pairing with invitation links and QR codes
- Projects, tags, sorting, and search
- Workspace-wide global search
- Edit history and restore
- Trash and recovery
- Markdown preview, split view, syntax highlighting, and math rendering
- Portable Project import and export
- Installable PWA

## How it works

```text
                         Cloudflare
                    coordination only
                           │
              ┌────────────┴────────────┐
              │                         │
          Device A ═════════════════ Device B
                    WebRTC DataChannel
                  direct or TURN relay

             encrypted Loro state
              using WorkspaceKey
```

Cloudflare provides the control plane: peer rendezvous, signaling bootstrap, invitations, and security-state ordering.

Workspace data uses a separate data plane. Encrypted Loro updates are exchanged between devices through WebRTC. When a direct connection cannot be established, the official client can use Cloudflare Realtime TURN as a transport relay; the relayed application payload remains encrypted.

The coordinator does not receive plaintext Workspace data or `WorkspaceKey` values.

For the detailed model, see [docs/architecture.md](docs/architecture.md). TURN behavior is documented in [docs/turn.md](docs/turn.md).

## Try it

The current web deployment is available at:

**https://floe.pwll.dev**

Floe Note is still experimental. Back up important notes separately before relying on it for daily use.

## Security

Floe Note separates collaborative document state from security-critical authorization state.

The current design includes:

- application-layer encryption for persistent Workspace data and synchronization traffic;
- a Workspace-level symmetric `WorkspaceKey`;
- device authorization represented by signed, linearly ordered security transitions;
- WebAuthn-backed device vault handling;
- key rotation when a device is revoked;
- a coordinator that handles metadata and ordering without receiving plaintext note contents or Workspace keys.

The security architecture has **not** received an independent security audit. The implementation and protocol should be treated as experimental.

See [docs/architecture.md](docs/architecture.md) for the security model and protocol boundaries.

## Development

The repository is a pnpm workspace. CI currently uses Node.js 22, and the repository pins pnpm 10.17.1.

Install dependencies:

```sh
pnpm install
```

Start the web application:

```sh
pnpm dev
```

Start the coordinator separately when working on synchronization or device coordination:

```sh
pnpm dev:coordinator
```

Useful checks:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm e2e
```

## Repository layout

```text
apps/
├── web/          Web application
├── coordinator/  Cloudflare coordinator
└── turn/         Development TURN compatibility service

packages/
├── crypto/       Application-layer cryptography
├── document/     Loro-backed document model
├── domain/       Shared domain identifiers and types
├── pairing/      Device pairing and WorkspaceKey delivery
├── security/     SecurityState and authorization transitions
├── storage/      Local persistence
├── sync/         Workspace synchronization protocol
├── transport/    BroadcastChannel and WebRTC transports
└── vault/        Device Vault and WebAuthn integration
```

The architecture is described in more detail in [docs/architecture.md](docs/architecture.md).

## Project status

Floe Note is a v0 project and is actively evolving. Features, storage details, protocol behavior, and UI may change as the design is refined.

Issues and pull requests are used to document design decisions and implementation work.

## License

Floe Note is licensed under the [GNU Affero General Public License v3.0](LICENSE).
