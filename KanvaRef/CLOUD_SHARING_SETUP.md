# Cloud Sharing Setup (Cloudflare Pages + Functions + D1)

## 1) D1 schema

Schema file: `d1/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS shared_boards (
  id TEXT PRIMARY KEY,
  board_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_boards_created_at
  ON shared_boards (created_at DESC);
```

## 2) Pages Functions added

- `functions/api/share.ts`
  - `POST /api/share`
  - Validates `Content-Type`, payload size, and same-origin
  - Generates UUID via `crypto.randomUUID()`
  - Uses parameterized D1 insert (`bind(...)`)
  - Returns `201` with `{ id }`

- `functions/api/board/[id].ts`
  - `GET /api/board/:id`
  - Validates same-origin and UUID format
  - Uses parameterized D1 select (`bind(...)`)
  - Returns `200` with `{ id, board, createdAt }` or `404`

## 3) Wrangler D1 binding

File: `wrangler.toml`

```toml
name = "kanvaref"
compatibility_date = "2026-02-15"
pages_build_output_dir = "./dist"

[[d1_databases]]
binding = "DB"
database_name = "kanvaref-db"
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
preview_database_id = "REPLACE_WITH_YOUR_D1_PREVIEW_DATABASE_ID"
```

Replace the two `REPLACE_*` values with actual IDs from Cloudflare.

## 4) Cloudflare Dashboard setup

1. In Cloudflare Dashboard, create a D1 database named `kanvaref-db`.
2. Copy the database ID and preview ID into `wrangler.toml`.
3. Go to your Pages project:
   - `Settings` -> `Functions` -> `D1 bindings`
   - Add binding:
     - `Variable name`: `DB`
     - `D1 database`: `kanvaref-db`
4. Ensure your Pages project builds this repo folder (`KanvaRef`) and outputs `dist`.

## 5) Run migration

From `KanvaRef/`:

```powershell
npx wrangler d1 execute kanvaref-db --file=./d1/schema.sql --remote
```

For local dev DB:

```powershell
npx wrangler d1 execute kanvaref-db --file=./d1/schema.sql --local
```

## 6) Example frontend fetch usage

### Share board

```js
const response = await fetch('/api/share', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ board: boardJson }),
})

if (!response.ok) throw new Error('Share failed')
const { id } = await response.json()
const shareUrl = `${window.location.origin}/board/${id}`
```

### Load shared board

```js
const response = await fetch(`/api/board/${id}`, { method: 'GET' })
if (response.status === 404) {
  // no shared board found
} else if (!response.ok) {
  throw new Error('Load failed')
}
const { board } = await response.json()
```

## 7) Deployment

1. Build:

```powershell
npm run build
```

2. Deploy Pages (if using Wrangler deploy flow):

```powershell
npx wrangler pages deploy dist --project-name kanvaref
```

Or push to your connected Git branch and let Cloudflare Pages deploy automatically.

## 8) Production troubleshooting checklist

If `POST /api/share` does not appear in browser DevTools:

1. Confirm frontend uses relative API paths (already implemented):
   - `fetch('/api/share', ...)`
   - `fetch('/api/board/${id}', ...)`
2. In Cloudflare Pages project settings, set:
   - `Root directory`: `KanvaRef`
   - `Build command`: `npm run build`
   - `Build output directory`: `dist`
3. In Pages deployment details, verify Functions were detected:
   - Routes should include `/api/share` and `/api/board/:id`.
4. In Pages settings, verify D1 binding exists:
   - Binding name must be exactly `DB`.
5. Re-deploy and test:
   - `POST https://<your-domain>/api/share` should return `201` with `{ "id": "<uuid>" }`.
   - `GET https://<your-domain>/api/board/<uuid>` should return `200` or `404`.
