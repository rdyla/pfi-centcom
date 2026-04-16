ALTER TABLE tenant_provider_connections
ADD COLUMN external_account_id TEXT;

ALTER TABLE tenant_provider_connections
ADD COLUMN webhook_routing_key TEXT;

CREATE INDEX idx_connections_provider_external_account
	ON tenant_provider_connections (provider_id, external_account_id);

CREATE INDEX idx_connections_provider_routing_key
	ON tenant_provider_connections (provider_id, webhook_routing_key);
