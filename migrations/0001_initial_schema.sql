PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
	timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE providers (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tenant_provider_connections (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	provider_id TEXT NOT NULL,
	display_name TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
	webhook_secret_ref TEXT,
	auth_config_json TEXT,
	last_seen_at TEXT,
	last_error_at TEXT,
	last_error_message TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
	FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
	UNIQUE (tenant_id, provider_id, display_name)
);

CREATE TABLE webhook_ingest_events (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	provider_id TEXT NOT NULL,
	connection_id TEXT,
	provider_event_id TEXT,
	provider_event_type TEXT NOT NULL,
	resource_type TEXT NOT NULL,
	delivery_id TEXT,
	idempotency_key TEXT NOT NULL,
	signature_status TEXT NOT NULL DEFAULT 'pending' CHECK (signature_status IN ('pending', 'verified', 'failed', 'skipped')),
	received_at TEXT NOT NULL,
	queued_at TEXT,
	raw_payload_json TEXT NOT NULL,
	headers_json TEXT,
	processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'queued', 'processed', 'ignored', 'failed')),
	error_message TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
	FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
	FOREIGN KEY (connection_id) REFERENCES tenant_provider_connections(id) ON DELETE SET NULL,
	UNIQUE (tenant_id, provider_id, idempotency_key)
);

CREATE TABLE normalized_events (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	ingest_event_id TEXT NOT NULL UNIQUE,
	provider_id TEXT NOT NULL,
	provider_event_id TEXT,
	provider_event_type TEXT NOT NULL,
	resource_type TEXT NOT NULL,
	resource_id TEXT,
	severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
	status TEXT,
	occurred_at TEXT NOT NULL,
	actor_json TEXT,
	subject_json TEXT,
	location_json TEXT,
	payload_json TEXT NOT NULL,
	fingerprint TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
	FOREIGN KEY (ingest_event_id) REFERENCES webhook_ingest_events(id) ON DELETE CASCADE,
	FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
	UNIQUE (tenant_id, fingerprint)
);

CREATE TABLE alert_rules (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	name TEXT NOT NULL,
	description TEXT,
	is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
	severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
	resource_type TEXT,
	provider_slug TEXT,
	conditions_json TEXT NOT NULL,
	actions_json TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE alerts (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	rule_id TEXT,
	title TEXT NOT NULL,
	description TEXT,
	severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'suppressed')),
	source TEXT NOT NULL,
	resource_type TEXT,
	resource_id TEXT,
	fingerprint TEXT NOT NULL,
	first_event_at TEXT NOT NULL,
	last_event_at TEXT NOT NULL,
	acknowledged_at TEXT,
	acknowledged_by TEXT,
	resolved_at TEXT,
	resolved_by TEXT,
	suppressed_until TEXT,
	metadata_json TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
	FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE SET NULL,
	UNIQUE (tenant_id, fingerprint)
);

CREATE TABLE alert_events (
	id TEXT PRIMARY KEY,
	alert_id TEXT NOT NULL,
	normalized_event_id TEXT NOT NULL,
	linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
	FOREIGN KEY (normalized_event_id) REFERENCES normalized_events(id) ON DELETE CASCADE,
	UNIQUE (alert_id, normalized_event_id)
);

CREATE TABLE cases (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	alert_id TEXT,
	external_system TEXT NOT NULL DEFAULT 'dynamics_ce',
	external_case_id TEXT,
	external_case_number TEXT,
	status TEXT NOT NULL CHECK (status IN ('pending', 'open', 'resolved', 'failed', 'closed')),
	last_synced_at TEXT,
	last_sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (last_sync_status IN ('pending', 'success', 'failed')),
	last_sync_error TEXT,
	payload_json TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
	FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE SET NULL,
	UNIQUE (tenant_id, external_system, external_case_id)
);

CREATE TABLE case_sync_attempts (
	id TEXT PRIMARY KEY,
	case_id TEXT NOT NULL,
	tenant_id TEXT NOT NULL,
	attempt_number INTEGER NOT NULL DEFAULT 1,
	request_json TEXT,
	response_json TEXT,
	status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
	error_message TEXT,
	attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE notification_channels (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('email', 'teams', 'slack', 'sms', 'webhook')),
	name TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
	config_json TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
	UNIQUE (tenant_id, type, name)
);

CREATE TABLE notification_deliveries (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	alert_id TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	delivery_key TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
	provider_message_id TEXT,
	error_message TEXT,
	sent_at TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
	FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
	FOREIGN KEY (channel_id) REFERENCES notification_channels(id) ON DELETE CASCADE,
	UNIQUE (tenant_id, channel_id, delivery_key)
);

CREATE TABLE users (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	email TEXT NOT NULL,
	display_name TEXT NOT NULL,
	role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
	last_login_at TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
	UNIQUE (tenant_id, email)
);

CREATE TABLE audit_log (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'integration')),
	actor_id TEXT,
	action TEXT NOT NULL,
	target_type TEXT NOT NULL,
	target_id TEXT,
	metadata_json TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_connections_tenant_status
	ON tenant_provider_connections (tenant_id, status);

CREATE INDEX idx_ingest_tenant_received
	ON webhook_ingest_events (tenant_id, received_at DESC);

CREATE INDEX idx_ingest_processing_status
	ON webhook_ingest_events (processing_status, queued_at);

CREATE INDEX idx_normalized_tenant_occurred
	ON normalized_events (tenant_id, occurred_at DESC);

CREATE INDEX idx_normalized_resource
	ON normalized_events (tenant_id, resource_type, resource_id);

CREATE INDEX idx_alerts_tenant_status
	ON alerts (tenant_id, status, severity, last_event_at DESC);

CREATE INDEX idx_alert_events_alert
	ON alert_events (alert_id, linked_at DESC);

CREATE INDEX idx_cases_tenant_status
	ON cases (tenant_id, status, last_synced_at DESC);

CREATE INDEX idx_case_sync_case_attempted
	ON case_sync_attempts (case_id, attempted_at DESC);

CREATE INDEX idx_notifications_tenant_status
	ON notification_deliveries (tenant_id, status, created_at DESC);

CREATE INDEX idx_audit_tenant_created
	ON audit_log (tenant_id, created_at DESC);

INSERT INTO providers (id, slug, name, status)
VALUES
	('provider_zoom', 'zoom', 'Zoom', 'active'),
	('provider_ringcentral', 'ringcentral', 'RingCentral', 'active');
