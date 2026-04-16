import { Form, data, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin";
import { requireAdminUser } from "../../workers/auth/entra";
import {
	createProviderConnection,
	listProviderConnections,
	listProviderOptions,
	ProviderConnectionError,
} from "../../workers/db/provider-connections";
import { createTenant, listTenants, TenantAdminError } from "../../workers/db/tenants";

const createTenantSchema = z.object({
	name: z.string().trim().min(2, "Tenant name must be at least 2 characters."),
	slug: z
		.string()
		.trim()
		.min(2, "Slug must be at least 2 characters.")
		.regex(/^[a-z0-9-]+$/, "Slug may contain lowercase letters, numbers, and hyphens only."),
	timezone: z.string().trim().min(1, "Timezone is required."),
});

const createConnectionSchema = z.object({
	tenantId: z.string().trim().min(1, "Tenant is required."),
	providerSlug: z.enum(["zoom", "ringcentral"]),
	displayName: z.string().trim().min(2, "Display name must be at least 2 characters."),
	externalAccountId: z.string().trim().optional(),
	webhookRoutingKey: z.string().trim().optional(),
	apiBaseUrl: z.string().trim().optional(),
	clientId: z.string().trim().optional(),
	webhookSecret: z.string().trim().optional(),
	credentialsJson: z.string().trim().optional(),
});

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Admin | PFI CentCom" },
		{
			name: "description",
			content: "Admin tools for managing PFI CentCom tenants and platform configuration.",
		},
	];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	if (!context.cloudflare.env.DB) {
		throw data({ error: "D1 binding 'DB' is not configured." }, { status: 500 });
	}

	const user = await requireAdminUser(request, context.cloudflare.env);
	if (!user) {
		throw redirect("/auth/login?returnTo=/admin");
	}

	return {
		user,
		tenants: await listTenants(context.cloudflare.env.DB),
		providers: await listProviderOptions(context.cloudflare.env.DB),
		connections: await listProviderConnections(context.cloudflare.env.DB),
		hasSecretsKv: Boolean(context.cloudflare.env.PFI_SECRETS_KV),
	};
}

export async function action({ request, context }: Route.ActionArgs) {
	if (!context.cloudflare.env.DB) {
		throw data({ formError: "D1 binding 'DB' is not configured." }, { status: 500 });
	}

	const user = await requireAdminUser(request, context.cloudflare.env);
	if (!user) {
		throw redirect("/auth/login?returnTo=/admin");
	}

	const formData = await request.formData();
	const intent = formData.get("intent");

	if (intent === "createTenant") {
		const submission = createTenantSchema.safeParse({
			name: formData.get("name"),
			slug: formData.get("slug"),
			timezone: formData.get("timezone"),
		});

		if (!submission.success) {
			return data(
				{
					intent,
					formError: "Please correct the tenant details and try again.",
					tenantFieldErrors: submission.error.flatten().fieldErrors,
				},
				{ status: 400 },
			);
		}

		try {
			await createTenant(context.cloudflare.env.DB, submission.data);
			return data({ intent, ok: true });
		} catch (error) {
			if (error instanceof TenantAdminError) {
				return data({ intent, formError: error.message }, { status: error.status });
			}

			throw error;
		}
	}

	if (intent === "createConnection") {
		const submission = createConnectionSchema.safeParse({
			tenantId: formData.get("tenantId"),
			providerSlug: formData.get("providerSlug"),
			displayName: formData.get("displayName"),
			externalAccountId: formData.get("externalAccountId"),
			webhookRoutingKey: formData.get("webhookRoutingKey"),
			apiBaseUrl: formData.get("apiBaseUrl"),
			clientId: formData.get("clientId"),
			webhookSecret: formData.get("webhookSecret"),
			credentialsJson: formData.get("credentialsJson"),
		});

		if (!submission.success) {
			return data(
				{
					intent,
					formError: "Please correct the provider connection details and try again.",
					connectionFieldErrors: submission.error.flatten().fieldErrors,
				},
				{ status: 400 },
			);
		}

		try {
			await createProviderConnection(
				context.cloudflare.env.DB,
				context.cloudflare.env.PFI_SECRETS_KV,
				submission.data,
			);
			return data({ intent, ok: true });
		} catch (error) {
			if (error instanceof ProviderConnectionError) {
				return data({ intent, formError: error.message }, { status: error.status });
			}

			throw error;
		}
	}

	return data({ formError: "Unsupported admin action." }, { status: 400 });
}

export default function Admin({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const isSubmitting = navigation.state === "submitting";
	const tenantActionActive = isSubmitting && navigation.formData?.get("intent") === "createTenant";
	const connectionActionActive =
		isSubmitting && navigation.formData?.get("intent") === "createConnection";

	return (
		<main className="centcom-shell">
			<section className="hero-panel">
				<div className="hero-copy">
					<p className="eyebrow">Admin Path</p>
					<h1>Tenant and provider administration</h1>
					<p className="hero-text">
						Manage tenant records, provider routing metadata, and connection secrets here
						so webhook intake and downstream alerting have a real operational control
						plane.
					</p>
					<div className="hero-actions">
						<a className="secondary-link" href="/auth/logout">
							Sign out {loaderData.user.name}
						</a>
					</div>
				</div>
				<div className="status-grid admin-status-grid">
					<article className="status-card">
						<span className="status-label">Tenants</span>
						<strong>{loaderData.tenants.length}</strong>
					</article>
					<article className="status-card">
						<span className="status-label">Connections</span>
						<strong>{loaderData.connections.length}</strong>
					</article>
					<article className="status-card">
						<span className="status-label">Path</span>
						<strong>/admin</strong>
					</article>
					<article className="status-card">
						<span className="status-label">Secrets KV</span>
						<strong>{loaderData.hasSecretsKv ? "Connected" : "Pending binding"}</strong>
					</article>
					<article className="status-card">
						<span className="status-label">Auth</span>
						<strong>Pending Entra SSO</strong>
					</article>
				</div>
			</section>

			<section className="content-grid admin-grid">
				<article className="panel">
					<div className="panel-heading">
						<p className="eyebrow">Create Tenant</p>
						<h2>New organization</h2>
					</div>
					<Form className="admin-form" method="post">
						<input name="intent" type="hidden" value="createTenant" />
						<label className="form-field">
							<span>Name</span>
							<input name="name" placeholder="PFI West" required type="text" />
							{actionData?.intent === "createTenant" && actionData?.tenantFieldErrors?.name ? (
								<small>{actionData.tenantFieldErrors.name[0]}</small>
							) : null}
						</label>

						<label className="form-field">
							<span>Slug</span>
							<input name="slug" placeholder="pfi-west" required type="text" />
							{actionData?.intent === "createTenant" && actionData?.tenantFieldErrors?.slug ? (
								<small>{actionData.tenantFieldErrors.slug[0]}</small>
							) : null}
						</label>

						<label className="form-field">
							<span>Timezone</span>
							<input
								defaultValue="America/Los_Angeles"
								name="timezone"
								required
								type="text"
							/>
							{actionData?.intent === "createTenant" &&
							actionData?.tenantFieldErrors?.timezone ? (
								<small>{actionData.tenantFieldErrors.timezone[0]}</small>
							) : null}
						</label>

						{actionData?.intent === "createTenant" && actionData?.formError ? (
							<p className="form-message form-message-error">{actionData.formError}</p>
						) : null}
						{actionData?.intent === "createTenant" && actionData?.ok ? (
							<p className="form-message form-message-success">
								Tenant created. Webhook ingest can now resolve this tenant.
							</p>
						) : null}

						<button className="primary-button" disabled={isSubmitting} type="submit">
							{tenantActionActive ? "Creating tenant..." : "Create tenant"}
						</button>
					</Form>
				</article>

				<article className="panel">
					<div className="panel-heading">
						<p className="eyebrow">Provider Connection</p>
						<h2>Associate provider credentials</h2>
					</div>
					<Form className="admin-form" method="post">
						<input name="intent" type="hidden" value="createConnection" />

						<label className="form-field">
							<span>Tenant</span>
							<select name="tenantId" required>
								<option value="">Select tenant</option>
								{loaderData.tenants.map((tenant) => (
									<option key={tenant.id} value={tenant.id}>
										{tenant.name}
									</option>
								))}
							</select>
							{actionData?.intent === "createConnection" &&
							actionData?.connectionFieldErrors?.tenantId ? (
								<small>{actionData.connectionFieldErrors.tenantId[0]}</small>
							) : null}
						</label>

						<label className="form-field">
							<span>Provider</span>
							<select name="providerSlug" required>
								{loaderData.providers.map((provider) => (
									<option key={provider.id} value={provider.slug}>
										{provider.name}
									</option>
								))}
							</select>
						</label>

						<label className="form-field">
							<span>Display name</span>
							<input
								name="displayName"
								placeholder="Zoom Prod Tenant"
								required
								type="text"
							/>
							{actionData?.intent === "createConnection" &&
							actionData?.connectionFieldErrors?.displayName ? (
								<small>{actionData.connectionFieldErrors.displayName[0]}</small>
							) : null}
						</label>

						<label className="form-field">
							<span>External account ID</span>
							<input
								name="externalAccountId"
								placeholder="Zoom account id or RingCentral account id"
								type="text"
							/>
						</label>

						<label className="form-field">
							<span>Webhook routing key</span>
							<input
								name="webhookRoutingKey"
								placeholder="Subscription id, endpoint key, or similar"
								type="text"
							/>
						</label>

						<label className="form-field">
							<span>API base URL</span>
							<input
								name="apiBaseUrl"
								placeholder="https://api.zoom.us or custom regional endpoint"
								type="text"
							/>
						</label>

						<label className="form-field">
							<span>Client ID</span>
							<input name="clientId" placeholder="Public app client id" type="text" />
						</label>

						<label className="form-field">
							<span>Webhook secret</span>
							<input
								name="webhookSecret"
								placeholder="Stored in KV when provided"
								type="password"
							/>
						</label>

						<label className="form-field">
							<span>Credentials JSON</span>
							<textarea
								name="credentialsJson"
								placeholder='{"clientSecret":"...","refreshToken":"..."}'
								rows={6}
							/>
						</label>

						{!loaderData.hasSecretsKv ? (
							<p className="form-message form-message-warning">
								Secrets KV is not configured yet. You can still save routing metadata,
								but webhook secrets and credential JSON require a KV binding.
							</p>
						) : null}

						{actionData?.intent === "createConnection" && actionData?.formError ? (
							<p className="form-message form-message-error">{actionData.formError}</p>
						) : null}
						{actionData?.intent === "createConnection" && actionData?.ok ? (
							<p className="form-message form-message-success">
								Provider connection created. This tenant can now be mapped to inbound
								webhooks and future API sync jobs.
							</p>
						) : null}

						<button className="primary-button" disabled={isSubmitting} type="submit">
							{connectionActionActive ? "Saving connection..." : "Save connection"}
						</button>
					</Form>
				</article>

				<article className="panel">
					<div className="panel-heading">
						<p className="eyebrow">Tenant Directory</p>
						<h2>Configured tenants</h2>
					</div>
					{loaderData.tenants.length === 0 ? (
						<p className="empty-state">
							No tenants yet. Create the first one here before testing webhook ingestion.
						</p>
					) : (
						<div className="tenant-list">
							{loaderData.tenants.map((tenant) => (
								<div className="tenant-card" key={tenant.id}>
									<div>
										<h3>{tenant.name}</h3>
										<p>{tenant.slug}</p>
									</div>
									<div className="tenant-meta">
										<span className={`badge badge-${tenant.status}`}>{tenant.status}</span>
										<span>{tenant.timezone}</span>
									</div>
								</div>
							))}
						</div>
					)}
				</article>

				<article className="panel panel-wide">
					<div className="panel-heading">
						<p className="eyebrow">Connections</p>
						<h2>Provider connections</h2>
					</div>
					{loaderData.connections.length === 0 ? (
						<p className="empty-state">
							No provider connections yet. Add one above to tie a tenant to Zoom or
							RingCentral metadata and secrets.
						</p>
					) : (
						<div className="tenant-list">
							{loaderData.connections.map((connection) => (
								<div className="tenant-card" key={connection.id}>
									<div>
										<h3>{connection.displayName}</h3>
										<p>
											{connection.tenantName} · {connection.providerSlug}
										</p>
									</div>
									<div className="tenant-meta">
										<span className={`badge badge-${connection.status}`}>
											{connection.status}
										</span>
										{connection.externalAccountId ? (
											<span>Account: {connection.externalAccountId}</span>
										) : null}
										{connection.webhookRoutingKey ? (
											<span>Route: {connection.webhookRoutingKey}</span>
										) : null}
										{connection.hasWebhookSecret ? <span>Webhook secret stored</span> : null}
										{connection.hasCredentialSecret ? <span>Credentials stored</span> : null}
									</div>
								</div>
							))}
						</div>
					)}
				</article>
			</section>
		</main>
	);
}
