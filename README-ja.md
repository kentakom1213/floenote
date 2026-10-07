# Floe Note

端末間で同期する，local-first・エンドツーエンド暗号化の Markdown ノートです．

[English](README.md) | [日本語](README-ja.md)

**Floe Note は現在開発中の実験的なソフトウェアです．** 失うことのできないデータの唯一の保存先としては使用せず，重要なノートは別途バックアップしてください．また，セキュリティ設計は第三者による独立した監査を受けていません．

[Floe Note を試す](https://floe.pwll.dev)

## About

Floe Note は，1人が複数の端末で使うことを前提とした，プライバシー志向の local-first ノートアプリです．

基本的な設計はシンプルです．

- ノートは端末上で利用でき，オフラインでも編集できます．
- 認証済みの端末間では，Workspace のデータを WebRTC で同期します．
- 可能な場合は端末間を直接接続し，直接接続できない場合は TURN relay にフォールバックします．
- Cloudflare は rendezvous，signaling，招待，security state の調停に使用し，ノート本文の保存には使用しません．
- 同時編集は [Loro](https://www.loro.dev/) CRDT によってマージします．
- 永続化される Workspace データは，保存時・通信時の両方でアプリケーション層により暗号化します．

**Workspace** は同期・認証・暗号化の境界です．**Project** は Workspace 内でノートを整理するための軽量な単位であり，独立したセキュリティ境界ではありません．

## Features

- オフラインで利用できる local-first な Markdown 編集
- エンドツーエンド暗号化された複数端末間同期
- WebRTC による直接同期と，自動的な TURN relay フォールバック
- 招待リンク・QR コードによる端末追加
- Project，タグ，ソート，検索
- Workspace 全体を対象とした global search
- 編集履歴と復元
- ゴミ箱と復元
- Markdown プレビュー，左右分割表示，シンタックスハイライト，数式表示
- Project 単位のポータブルな import / export
- インストール可能な PWA

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

Cloudflare は control plane を担当し，peer rendezvous，signaling bootstrap，招待，security state の順序付けを行います．

Workspace のデータは別の data plane を通ります．暗号化された Loro update を WebRTC 経由で端末間に送信します．直接接続できない場合，公式クライアントは Cloudflare Realtime TURN を transport relay として利用できますが，中継されるアプリケーションの payload は暗号化されたままです．

Coordinator が平文の Workspace データや `WorkspaceKey` を受け取ることはありません．

詳細な設計は [docs/architecture.md](docs/architecture.md) を参照してください．TURN の挙動は [docs/turn.md](docs/turn.md) にまとめています．

## Try it

現在の Web 版は以下から利用できます．

**https://floe.pwll.dev**

Floe Note はまだ実験段階です．日常的に利用する場合も，重要なノートは別途バックアップしてください．

## Security

Floe Note では，CRDT による共同状態と，セキュリティ上重要な認証状態を分離しています．

現在の設計には以下が含まれます．

- 永続化される Workspace データと同期トラフィックのアプリケーション層暗号化
- Workspace 単位の共通鍵 `WorkspaceKey`
- 署名され，線形に順序付けされた security transition による端末認証状態の管理
- WebAuthn を利用した Device Vault
- 端末 revoke 時の key rotation
- 平文のノート内容や Workspace key を受け取らず，metadata と順序付けを担当する Coordinator

セキュリティ設計は**第三者による独立した監査を受けていません**．現時点の実装とプロトコルは実験的なものとして扱ってください．

セキュリティモデルと各レイヤーの境界については [docs/architecture.md](docs/architecture.md) を参照してください．

## Development

このリポジトリは pnpm workspace です．CI では現在 Node.js 22 を使用し，pnpm 10.17.1 を指定しています．

依存関係をインストールします．

```sh
pnpm install
```

Web アプリケーションを起動します．

```sh
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

より詳しい構成は [docs/architecture.md](docs/architecture.md) にまとめています．

## Project status

Floe Note は現在 v0 で，継続的に開発しています．設計の改善に伴い，機能，保存形式，プロトコルの挙動，UI は変更される可能性があります．

設計上の判断や実装作業は Issues / Pull Requests に記録しています．

## License

Floe Note は [GNU Affero General Public License v3.0](LICENSE) のもとで公開しています．
