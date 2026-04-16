# PFI CentCom

PFI CentCom is a Cloudflare-based monitoring and alerting platform for Zoom, RingCentral, and Dynamics 365 CE case orchestration.

## Current foundation

- React Router + Vite operator UI
- Cloudflare Worker runtime
- Hono API and webhook surface
- Queue-ready webhook ingestion flow
- Initial D1 schema migration for tenants, alerts, and case sync
- Shared TypeScript domain contracts for provider normalization
- Architecture proposal in [docs/architecture.md](docs/architecture.md)

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

## Type generation

```bash
npm run cf-typegen
```

## Database setup

See [docs/d1-setup.md](docs/d1-setup.md) for D1 creation, binding, and migration commands.

## Entra SSO setup

See [docs/entra-setup.md](docs/entra-setup.md) for the Entra app registration values and Worker secret configuration used by the admin path.

## Production build

```bash
npm run build
```

## Available endpoints

- `/` operator landing page
- `/health` runtime health and binding status
- `/api/system/overview` platform overview payload for UI/API consumers
- `/webhooks/zoom` webhook intake scaffold
- `/webhooks/ringcentral` webhook intake scaffold

## Next implementation steps

1. Replace placeholder webhook acceptance with signature verification plus ingest persistence.
2. Add a D1 repository layer for ingest events, alerts, and case state.
3. Attach queue consumers to normalization, rule evaluation, and Dynamics CE sync.
4. Add authenticated operator workflows for alert triage and case visibility.
