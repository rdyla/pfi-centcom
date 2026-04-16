# PFI CentCom Architecture Proposal

## Goal

Build a central monitoring and alerting platform that:

- receives webhook events from Zoom, RingCentral, and other providers
- supports multiple tenants with isolated configuration
- evaluates rules and creates alerts/incidents
- syncs incidents with Dynamics 365 CE cases
- provides an operator UI for monitoring, triage, and audit history

## Recommended Stack

Use the current Cloudflare Worker + React Router/Vite template as the application foundation.

### Core platform

- Runtime: Cloudflare Workers
- Web framework: Hono for API routes and webhook endpoints
- UI: React + React Router + Vite
- Auth: Cloudflare Access or external IdP with OIDC/SAML in front of the app
- Validation: `zod`
- Logging/observability: Cloudflare Observability + structured JSON logs

### Data and async processing

- Primary relational store: Cloudflare D1
- Durable async ingestion: Cloudflare Queues
- Long-running coordination and rate-limited integrations: Durable Objects
- Secrets: Wrangler secrets / environment bindings
- Blob storage for raw payload snapshots or attachments: R2 if needed

### Notifications

- Email: provider of choice via queue-driven adapter
- Teams/Slack/SMS: adapter pattern behind a common notification interface
- Escalation scheduling: Worker cron triggers plus queue jobs

### External integrations

- Zoom webhooks -> webhook adapter
- RingCentral webhooks -> webhook adapter
- Dynamics 365 CE -> outbound integration client with retry and idempotency

## Why This Stack Fits

This workload is a strong fit for Cloudflare if we treat the Worker as the edge/API shell and avoid doing all coordination inline with the webhook request.

- Webhooks need fast acknowledgement: Workers are great at signature validation, normalization, and queueing.
- Alert processing should be durable and retryable: Queues handle this better than direct request-time processing.
- Multi-tenant config and audit data fit relational storage well: D1 is a good starting point.
- Integration state often needs locking, deduping, and rate control: Durable Objects are useful for per-tenant or per-case coordination.

## Architecture Shape

### 1. Edge/API app

One Worker app serves:

- React operator UI
- authenticated API routes
- public webhook ingestion routes

Suggested route groups:

- `/app/*` for UI
- `/api/*` for authenticated internal APIs
- `/webhooks/zoom`
- `/webhooks/ringcentral`
- `/health`

### 2. Ingestion pipeline

Webhook requests should do only the minimum synchronous work:

1. verify signature/authenticity
2. identify tenant and provider
3. persist an ingest record
4. enqueue a normalized processing message
5. return `200` quickly

That keeps provider retries low and prevents slow downstream systems from blocking webhook handling.

### 3. Processing pipeline

Queue consumers should:

1. load tenant configuration
2. normalize provider-specific events into a canonical event model
3. deduplicate by provider event id or computed fingerprint
4. evaluate correlation/rules
5. create or update incidents/alerts
6. trigger notifications
7. create or update Dynamics cases when required

### 4. Coordination layer

Use Durable Objects where ordering or locking matters, for example:

- one object per tenant for rate limiting and config caching
- one object per external case/integration key for serialized Dynamics updates
- one object per alert stream if event correlation needs strict ordering

Do not start with Durable Objects everywhere. Add them only where races or external API throttling make them worth it.

## Data Model

Start with a relational model in D1.

Core tables:

- `tenants`
- `providers`
- `tenant_provider_connections`
- `webhook_ingest_events`
- `normalized_events`
- `alert_rules`
- `alerts`
- `alert_events`
- `cases`
- `case_sync_attempts`
- `notification_channels`
- `notification_deliveries`
- `users`
- `audit_log`

Important design choices:

- Keep raw payload metadata and signature result for forensics.
- Store idempotency keys on ingest and outbound sync operations.
- Treat provider connection settings as tenant-scoped records, not env vars.
- Make alert lifecycle explicit: `open`, `acknowledged`, `resolved`, `suppressed`.

## Multi-Tenant Model

Recommended default: single app, shared database, tenant-scoped rows.

Add strong tenant isolation in code and schema:

- every business table carries `tenant_id`
- queries always filter by `tenant_id`
- audit logs include actor and tenant
- provider credentials are stored per tenant

If a small number of tenants later require stronger isolation, you can move them to dedicated environments without rewriting the app model.

## Dynamics 365 CE Integration

Treat Dynamics as an asynchronous outbound integration, not part of the request path.

Recommended behavior:

- map alert severity/state to Dynamics case fields
- store Dynamics case id and sync status locally
- retry transient failures with backoff
- serialize updates per case to avoid conflicting writes
- record full request/response metadata needed for support, excluding secrets

## Domain Model Recommendation

Normalize all incoming provider payloads into a shared event model early.

Example canonical event fields:

- `tenantId`
- `provider`
- `providerEventType`
- `providerEventId`
- `occurredAt`
- `resourceType`
- `resourceId`
- `severity`
- `status`
- `actor`
- `subject`
- `location`
- `rawPayloadRef`

This keeps your rule engine and alert lifecycle independent from Zoom or RingCentral specifics.

## Suggested Package Structure

```text
app/
  routes/
  components/
  features/
workers/
  app.ts
  api/
  webhooks/
  queues/
  domain/
  integrations/
    zoom/
    ringcentral/
    dynamics/
  db/
  lib/
```

Suggested logical modules:

- `workers/webhooks/*`: signature verification and provider-specific parsing
- `workers/domain/*`: alert lifecycle, rule evaluation, case sync orchestration
- `workers/integrations/*`: external API adapters
- `workers/db/*`: repositories and schema access
- `workers/lib/*`: shared primitives like logger, ids, auth, config, and errors

## Opinionated Recommendations

### Keep

- Cloudflare Workers
- React/Vite/React Router
- TypeScript end to end

### Add

- Hono for backend route organization
- D1 for operational data
- Queues for durable background work
- Zod for schema validation

### Avoid at first

- Splitting into many services
- Building a custom workflow engine too early
- Overusing Durable Objects before concrete race conditions appear
- Pushing all business logic into UI route loaders/actions

## Delivery Plan

### Phase 1: foundation

- add Hono route composition inside the Worker
- add D1 and Queues bindings
- create schema for tenants, ingest events, alerts, and cases
- implement health check and structured logging

### Phase 2: ingest and normalize

- implement Zoom and RingCentral webhook endpoints
- verify signatures
- persist raw ingest records
- enqueue normalized events

### Phase 3: alerting

- build canonical event model
- add simple rules engine
- create alert lifecycle and operator dashboard

### Phase 4: Dynamics sync

- create async case create/update adapter
- add retries, idempotency, and sync audit trail

### Phase 5: notifications and escalation

- add email/Teams/Slack adapters
- add escalation policies and cron-based reminders

## Best Next Step

If you want to stay on your current template, the best next move is not changing frameworks. It is turning this starter into a clear split between:

- React UI
- Hono API/webhook surface
- queue-driven backend processing
- D1-backed domain model

That gives you a solid path to production without prematurely introducing extra infrastructure.
