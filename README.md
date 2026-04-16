# Scraper Service

指定URLを定期的に自動スクレイピングし、HTMLをメモリに保持してREST APIで取得できるサービスです。
ブラウザから操作できるAPIテストページと管理画面が付属しています。

## ファイル構成

```
プロジェクトルート/
├── src/
│   ├── index.ts          # エントリーポイント。ポート・デフォルトURL・スクレイピング間隔を設定する
│   ├── scraperService.ts # スクレイピングのロジックと結果の保持を担当するサービスクラス
│   ├── router.ts         # 公開API・管理APIのエンドポイント定義
│   ├── types.ts          # 型定義（ScrapeResult / ScrapedTarget / ApiResponse）
│   ├── public/
│   │   └── index.html    # 公開APIテストページ（port 3000）
│   ├── settingsStore.ts  # 設定の読み書き（data/settings.json）
│   └── admin/
│       └── index.html    # 管理画面（port 3001）
├── data/
│   └── settings.json     # 永続化された設定（自動生成）
├── dist/                 # ビルド後の出力先（自動生成）
├── node_modules/         # 依存パッケージ（自動生成）
├── package.json          # 依存パッケージとスクリプトの定義
├── tsconfig.json         # TypeScriptコンパイラの設定
└── README.md             # このファイル
```

### 各ファイルの役割

| ファイル | 役割 |
|---|---|
| `src/index.ts` | サーバー起動・cronスケジュール設定・デフォルトURL登録・静的ファイル配信 |
| `src/scraperService.ts` | URLの追加/削除・スクレイピング実行・結果の保持・デフォルトURL管理 |
| `src/router.ts` | 公開API用 `createPublicRouter` と管理API用 `createAdminRouter` を定義 |
| `src/types.ts` | アプリ全体で使う型定義 |
| `src/settingsStore.ts` | `data/settings.json` への設定の読み書き |
| `src/public/index.html` | port 3000 で配信されるAPIテストページ |
| `src/admin/index.html` | port 3001 で配信される管理画面 |

## セットアップ

```bash
npm install
npm run build
npm start
```

開発時（ts-node使用）:
```bash
npm install
npx ts-node src/index.ts
```

起動後、以下のURLにアクセスできます：

| URL | 内容 |
|---|---|
| `http://localhost:3000/` | 公開APIテストページ |
| `http://localhost:3000/api` | 公開REST API（結果取得のみ） |
| `http://localhost:3001/` | 管理画面 |
| `http://localhost:3001/api` | 管理REST API（全操作） |

## カスタマイズ

### デフォルトURLの設定
`src/index.ts` の `DEFAULT_URLS` に追加する：
```typescript
const DEFAULT_URLS: string[] = [
  "https://example.com",
  "https://example.org",  // 複数追加可能
];
```

### スクレイピング間隔の設定
`src/index.ts` の `SCRAPE_INTERVAL` を変更する：
```typescript
const SCRAPE_INTERVAL = "*/30 * * * * *"; // 30秒ごと
```

| 設定値 | 間隔 |
|---|---|
| `"*/10 * * * * *"` | 10秒ごと |
| `"*/30 * * * * *"` | 30秒ごと（デフォルト） |
| `"* * * * *"` | 1分ごと |
| `"*/5 * * * *"` | 5分ごと |
| `"0 * * * *"` | 1時間ごと |
| `"0 9 * * *"` | 毎日9時に1回 |

### ポートの変更
環境変数で変更可能：
```bash
PORT=8080 ADMIN_PORT=8081 npm start
```

## APIエンドポイント一覧

### ポート別アクセス制限

| エンドポイント | port 3000（公開） | port 3001（管理） |
|---|:---:|:---:|
| `GET  /api/health` | ✅ | ✅ |
| `GET  /api/defaults/latest` | ✅ | ✅ |
| `GET  /api/latest?url=` | ✅ | ✅ |
| `GET  /api/targets` | ❌ | ✅ |
| `GET  /api/targets/:id` | ❌ | ✅ |
| `GET  /api/targets/:id/history` | ❌ | ✅ |
| `POST /api/targets`（登録） | ❌ | ✅ |
| `DELETE /api/targets/:id`（削除） | ❌ | ✅ |
| `POST /api/targets/:id/scrape`（即時実行） | ❌ | ✅ |

---

### GET /api/health
サービスの稼働状態を確認します。

---

### GET /api/defaults/latest
`DEFAULT_URLS` に設定した全URLの最新スクレイピング結果をまとめて返します。

レスポンス例：
```json
{
  "success": true,
  "data": [
    {
      "url": "https://example.com",
      "result": {
        "html": "<!DOCTYPE html>...",
        "statusCode": 200,
        "scrapedAt": "2024-01-01T00:00:00.000Z",
        "success": true
      }
    }
  ]
}
```

---

### GET /api/latest?url=
URLを指定して最新のスクレイピング結果を取得します（IDなし）。

```
GET /api/latest?url=https://example.com
```

---

### GET /api/targets　（管理のみ）
登録済みURLの一覧を返します。`?url=` で絞り込んでIDを確認できます。

```
GET /api/targets
GET /api/targets?url=https://example.com
```

---

### GET /api/targets/:id　（管理のみ）
指定IDのターゲット詳細を返します。

---

### GET /api/targets/:id/history　（管理のみ）
スクレイピング履歴を新しい順に返します。

```
GET /api/targets/:id/history?limit=10
```
- `limit`: 取得件数（最大60、デフォルト10）

---

### POST /api/targets　（管理のみ）
新しいURLを登録します。登録後すぐにスクレイピングが実行されます。

```
POST /api/targets
Content-Type: application/json

{ "url": "https://example.com" }
```

---

### DELETE /api/targets/:id　（管理のみ）
指定したターゲットを削除します。

---

### POST /api/targets/:id/scrape　（管理のみ）
cronを待たずに今すぐスクレイピングを実行します。

---

## 管理画面（port 3001）

ブラウザで `http://localhost:3001/` を開くと管理画面が表示されます。

- 登録済みURL一覧（デフォルトURLはバッジで表示）
- URL登録・削除
- 即時スクレイピング実行
- 統計表示（総数 / 正常 / エラー）
- 30秒ごとに自動更新

## 仕様

- スクレイピング結果は**1ターゲットあたり最新60件**をメモリ保持（サービス再起動でリセット）
- タイムアウト: 15秒
- 複数URLの同時管理に対応
