# Floe Note

端末間で同期する，local-first・エンドツーエンド暗号化の Markdown ノートです．

[English](README.md) | [日本語](README-ja.md)

**Floe Note は現在開発中の実験的なソフトウェアです．** セキュリティ設計は第三者による独立した監査を受けていません．

[Floe Note を試す](https://floe.pwll.dev)

## About

Floe Note は，1人が複数の端末で使うことを前提とした，プライバシー志向のノートアプリです．

- ノートは端末上で利用でき，オフラインでも編集できます．
- 認証済み端末間で，暗号化された Workspace データを WebRTC で同期します．
- 可能な場合は端末間を直接接続し，必要に応じて TURN relay にフォールバックします．
- 同時編集は [Loro](https://www.loro.dev/) CRDT によってマージします．
- Cloudflare は端末の発見，signaling，招待などの調停に利用し，ノート本文は保存しません．

**Workspace** は同期・認証・暗号化の境界です．**Project** は Workspace 内でノートを整理する単位であり，独立したセキュリティ境界ではありません．

## Features

- local-first な Markdown 編集
- エンドツーエンド暗号化された複数端末間同期
- WebRTC による直接同期と自動的な TURN fallback
- 招待リンク・QR コードによる端末追加
- Project，タグ，ソート，検索
- Workspace 全体を対象とした global search
- 編集履歴，復元，ゴミ箱
- Markdown プレビュー，左右分割表示，シンタックスハイライト，数式表示
- Project 単位の import / export
- インストール可能な PWA

## How it works

```text
                   Cloudflare
                  coordination
                      │
          Device A ═══════ Device B
                WebRTC DataChannel
              direct or TURN relay
```

Workspace データは `WorkspaceKey` で暗号化してから同期します．Coordinator は端末同士の発見や接続を補助しますが，平文のノートデータや `WorkspaceKey` を受け取りません．

protocol と security architecture の詳細は [docs/architecture.md](docs/architecture.md) を参照してください．TURN の挙動は [docs/turn.md](docs/turn.md) にまとめています．

## Try it

現在の Web 版は **https://floe.pwll.dev** から利用できます．Floe Note はまだ実験段階なので，重要なノートは別途バックアップしてください．

## Security

Floe Note は永続化される Workspace データと同期トラフィックをアプリケーション層で暗号化し，端末認証と key rotation を行います．セキュリティ設計は**第三者による独立した監査を受けていません**．詳細は [docs/architecture.md](docs/architecture.md) を参照してください．

## Development

このリポジトリは pnpm workspace です．CI では現在 Node.js 22 と pnpm 10.17.1 を使用しています．

```sh
pnpm install
pnpm dev
```

同期や端末管理を開発するときは Coordinator も別途起動します．

```sh
pnpm dev:coordinator
```

主なチェックコマンドは以下です．

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

より詳しい構成は [docs/architecture.md](docs/architecture.md) にまとめています．

## License

Floe Note は [GNU Affero General Public License v3.0](LICENSE) のもとで公開しています．
