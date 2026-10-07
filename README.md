# Floe Note

Local-first, end-to-end encrypted Markdown notes that sync across your devices.

[English](README.md) | [日本語](README-ja.md)

**Floe Note is experimental software under active development.** Its security architecture has not received an independent security audit.

[Try Floe Note](https://floe.pwll.dev)

## About

Floe Note is a privacy-oriented note app for one person using multiple devices.

- Notes stay available locally and can be edited offline.
- Authorized devices synchronize encrypted Workspace data over WebRTC.
- Direct peer-to-peer connections are preferred, with TURN relay fallback when needed.
- Concurrent edits are merged with [Loro](https://www.loro.dev/) CRDTs.
- Cloudflare coordinates device discovery, signaling, invitations, and related metadata without storing note contents.

A **Workspace** is the synchronization, authorization, and encryption boundary. A **Project** organizes notes inside a Workspace and does not create a separate security boundary.

## Features

- Local-first Markdown editing
- End-to-end encrypted multi-device sync
- Direct WebRTC sync with automatic TURN fallback
- Device pairing with invitation links and QR codes
- Projects, tags, sorting, and search
- Workspace-wide global search
- Edit history, restore, and Trash
- Markdown preview, split view, syntax highlighting, and math rendering
- Portable Project import and export
- Installable PWA

## How it works

```text
                   Cloudflare
                  coordination
                      │
          Device A ═══════ Device B
                WebRTC DataChannel
              direct or TURN relay
```

Workspace data is encrypted with a `WorkspaceKey` before it is synchronized. The Coordinator helps devices find and connect to each other, but it does not receive plaintext note data or `WorkspaceKey` values.

For protocol and security details, see [docs/architecture.md](docs/architecture.md). TURN behavior is documented in [docs/turn.md](docs/turn.md).

## Try it

Use the current web deployment at **https://floe.pwll.dev**. Floe Note is still experimental, so keep separate backups of important notes.

## Security

Floe Note encrypts persistent Workspace data and synchronization traffic at the application layer, and supports device authorization and key rotation. The security architecture has **not** received an independent security audit; see [docs/architecture.md](docs/architecture.md) for details.

## Development

This repository is a pnpm workspace. CI currently uses Node.js 22 and pnpm 10.17.1.

```sh
pnpm install
pnpm dev
```

Start the Coordinator separately when working on synchronization or device coordination:

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
├── web/                 Web application
├── coordinator/         Cloudflare Coordinator
└── turn/                Development TURN compatibility service

packages/
├── coordinator-client/  Coordinator client
├── crypto/              Application-layer cryptography
├── document/            Loro-backed document model
├── domain/              Shared domain types
├── pairing/             Device pairing and WorkspaceKey delivery
├── security/            Device authorization and key lifecycle
├── storage/             Local persistence
├── sync/                Workspace synchronization
├── transport/           BroadcastChannel and WebRTC transports
└── vault/               Device Vault and WebAuthn integration
```

See [docs/architecture.md](docs/architecture.md) for the full architecture.

## License

Floe Note is licensed under the [GNU Affero General Public License v3.0](LICENSE).
