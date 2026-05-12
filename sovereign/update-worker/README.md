# Sovereign Update Feed Worker

Public update endpoint for Sovereign Code, served from
`https://updates.rueschegg.integral-it.ch`. Replaces stock VS Code's
`update.code.visualstudio.com` for our fork while preserving the exact
client protocol (no updater patch required).

## Protocol

The Electron updater calls:

```
GET https://updates.rueschegg.integral-it.ch/api/update/<platform>/<quality>/<currentCommit>
```

Responses:

| Condition | Response |
|---|---|
| platform ∈ {`linux-x64`, `linux-arm64`}, quality ∈ {`stable`}, manifest entry present, `entry.version === currentCommit` | `204 No Content` |
| same allowlist, `entry.version !== currentCommit` | `200`, body = entry JSON |
| disallowed platform/quality, missing entry, unknown path | `404` |
| upstream manifest fetch failure | `503` |

Entry shape:

```json
{
  "url":            "https://github.com/DanielFabian/vscode/releases/download/<tag>/<archive>.tar.gz",
  "version":        "<composed-source-commit>",
  "productVersion": "<sovereign-version>",
  "sha256hash":     "<hex>",
  "timestamp":      <ms-epoch>
}
```

`version` matches the value baked into the released artifact's
`product.json.commit` (the workflow sets `BUILD_SOURCEVERSION` to the
composed-stack HEAD), so the client's commit-equality check is meaningful.

## Source of truth

`manifest.json` on the orphan `manifest` branch of `DanielFabian/vscode`,
fetched via `raw.githubusercontent.com`. Promotion = one commit on that
branch. Rollback = `git revert`. The worker has zero state and no secrets.

Manifest shape:

```json
{
  "schemaVersion": 1,
  "channels": {
    "stable": {
      "linux-x64":   { "url": "...", "version": "...", "productVersion": "...", "sha256hash": "...", "timestamp": 0 },
      "linux-arm64": { "url": "...", "version": "...", "productVersion": "...", "sha256hash": "...", "timestamp": 0 }
    }
  }
}
```

## Develop

```
npm install
npm run typecheck
npm run dev    # wrangler dev, serves on http://localhost:8787
curl http://localhost:8787/api/update/linux-x64/stable/deadbeef
```

## Deploy

Manual, by a human with the Cloudflare account bound. No CI deploy: the
worker changes ~never and we deliberately keep CF API tokens out of CI.

```
npx wrangler deploy
```

DNS for `updates.rueschegg.integral-it.ch` is managed in the Cloudflare
zone `integral-it.ch`; the custom domain is attached via the worker
dashboard.

## What is intentionally *not* here

- No KV / D1 / Durable Objects. The manifest is the only state and it
  lives in git.
- No `/api/latest` debug endpoint. Validation hits the real route with a
  known-stale commit and asserts the JSON's `version`.
- No request logging. Cloudflare analytics gives volume/error rate
  without a privacy story.
- No version comparison. The protocol is pure equality on `commit`.
- No stale-manifest fallback on fetch failure. `503` is honest; the
  Linux updater treats it as "no update available", which is a safe
  transient no-op for clients.
