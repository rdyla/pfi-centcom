# D1 Setup

This repo now includes the initial Cloudflare D1 migration in [migrations/0001_initial_schema.sql](../migrations/0001_initial_schema.sql).

## What I changed

- Added the first schema migration for tenants, providers, connections, ingest events, normalized events, alerts, cases, notifications, users, and audit history.
- Seeded the `providers` table with `zoom` and `ringcentral`.
- Kept `wrangler.json` unchanged for D1 bindings because your actual `database_id` should come from your Cloudflare account, not from a guessed placeholder in source control.

## Create the database

Create the D1 database once from your terminal:

```bash
npx wrangler d1 create pfi-centcom
```

Wrangler will print a `database_id`. Add the returned binding to `wrangler.json` in a `d1_databases` section with:

- `binding`: `DB`
- `database_name`: your D1 database name
- `database_id`: the ID returned by Wrangler

## Apply migrations

For local development:

```bash
npx wrangler d1 migrations apply pfi-centcom --local
```

For the remote Cloudflare database:

```bash
npx wrangler d1 migrations apply pfi-centcom --remote
```

## Notes

- D1 migrations are not deployed automatically by my edits.
- GitHub is not updated automatically by my edits.
- I only change local files unless you explicitly ask me to deploy or push.
- Once the `DB` binding exists, the Worker health endpoint will report database availability.

## Recommended next step

After you create and bind the database, the next code slice should persist webhook ingest records into `webhook_ingest_events` before queueing them.
