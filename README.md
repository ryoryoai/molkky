# Molkky Realtime Score Sync

Cloudflare Pages + Workers + Durable Objects(WebSocket) で実装した、モルックスコア同期アプリです。

## 構成

- `apps/web`: React + Vite (TypeScript)
- `apps/worker`: Cloudflare Worker + Durable Object (TypeScript)

## 前提

- Node.js 20+
- npm 10+
- Wrangler 最新版（`npm install` で同梱されます）

## セットアップ

```bash
npm install
```

## ローカル開発

### 1) Worker

```bash
npm run dev:worker
```

- デフォルト: `http://127.0.0.1:8787`

### 2) Web

別ターミナルで:

```bash
cd apps/web
VITE_API_BASE=http://127.0.0.1:8787 npm run dev
```

- デフォルト: `http://localhost:5173`

### 3) 一括起動

```bash
npm run dev
```

一括起動時、`VITE_API_BASE` を使うなら以下のように実行:

```bash
VITE_API_BASE=http://127.0.0.1:8787 npm run dev
```

## デプロイ

## Worker

1. Cloudflare Secret に `TOKEN_PEPPER` を設定（最低32文字推奨）

```bash
npx wrangler secret put TOKEN_PEPPER --cwd apps/worker
```

2. デプロイ:

```bash
npm run deploy:worker
```

必要なら `workers_dev` ではなく route 設定を追加してください。

## Pages

1. `apps/web` に環境変数 `VITE_API_BASE` を設定（Worker の URL）
2. ビルド:

```bash
npm run build --workspace @molkky/web
```

3. デプロイ:

```bash
npm run deploy:web
```

Cloudflare Pages UI で設定する場合:

- Build command: `npm run build --workspace @molkky/web`
- Build output directory: `apps/web/dist`

## 動作確認（ブラウザ2つ）

1. ブラウザAでトップを開き、名前入力して「新規ルーム作成」
2. 生成された編集URLをコピーしてブラウザAでそのまま入室
3. 生成された閲覧URLをブラウザBで開く
4. ブラウザAで `single` / `multi` / `miss` / `foul` を操作
5. ブラウザBでスコア・手番がリアルタイム更新されることを確認
6. ブラウザAで `undo` し、直前1手のみ巻き戻ることを確認
7. 50点到達で `finished` になり、以後 action/undo が拒否されることを確認

## ルール実装の要点

- 1本倒し: `single 1..12`
- 2本以上: `multi 2..12`
- 50点ちょうどで勝利
- 50超えで25点へ戻し
- 0点（miss/foul）3連続で失格 + スコア0
- 取り消しは直前1手のみ
- 履歴は最大500件（超過時に古い履歴を削除）

## API

- `POST /api/room` -> `{ roomId, editToken, viewUrl, editUrl }`
- `GET /api/room/:roomId/snapshot`
- `GET /api/room/:roomId/ws?token=...`

WebSocket message:

- client -> server
  - `{ "type": "join", "name": "..." }`
  - `{ "type": "action", "action": { "type": "single"|"multi"|"miss"|"foul", "value"?: number } }`
  - `{ "type": "undo" }`
- server -> client
  - `{ "type": "state", "fullState": ... }`
  - `{ "type": "error", "message": "..." }`
  - `{ "type": "info", "message": "..." }`
