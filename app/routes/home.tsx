import type { Route } from "./+types/home";
import { Link } from "react-router";
import { getAuthenticatedUser } from "../../workers/auth/entra";
import { getPlatformStatus } from "../../workers/config/env";
import { platformOverview } from "../../workers/domain/events";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "PFI CentCom" },
		{
			name: "description",
			content: "Central monitoring and alerting for Zoom, RingCentral, and Dynamics CE.",
		},
	];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	return {
		user: await getAuthenticatedUser(request, context.cloudflare.env),
		overview: platformOverview,
		status: getPlatformStatus(context.cloudflare.env),
	};
}

export default function Home({ loaderData }: Route.ComponentProps) {
	return (
		<main className="centcom-shell">
			<section className="hero-panel">
				<div className="hero-copy">
					<p className="eyebrow">Mission Control</p>
					<h1>{loaderData.overview.title}</h1>
					<p className="hero-text">{loaderData.overview.description}</p>
					<div className="hero-actions">
						{loaderData.user ? (
							<>
								<Link className="primary-button" to="/admin">
									Open admin path
								</Link>
								<a className="secondary-link" href="/auth/logout">
									Sign out {loaderData.user.name}
								</a>
							</>
						) : (
							<a className="primary-button" href="/auth/login?returnTo=/admin">
								Sign in with Entra
							</a>
						)}
					</div>
				</div>

				<div className="status-grid">
					<article className="status-card">
						<span className="status-label">Environment</span>
						<strong>{loaderData.status.appEnv}</strong>
					</article>
					<article className="status-card">
						<span className="status-label">Database</span>
						<strong>{loaderData.status.hasDatabase ? "Connected" : "Pending binding"}</strong>
					</article>
					<article className="status-card">
						<span className="status-label">Queues</span>
						<strong>
							{loaderData.status.hasIngestQueue || loaderData.status.hasAlertQueue
								? "Partially ready"
								: "Pending bindings"}
						</strong>
					</article>
					<article className="status-card">
						<span className="status-label">Dynamics CE</span>
						<strong>
							{loaderData.status.hasDynamicsConfig ? "Configured" : "Config pending"}
						</strong>
					</article>
					<article className="status-card">
						<span className="status-label">Entra SSO</span>
						<strong>
							{loaderData.status.hasEntraConfig
								? loaderData.user
									? "Signed in"
									: "Configured"
								: "Config pending"}
						</strong>
					</article>
				</div>
			</section>

			<section className="content-grid">
				<article className="panel">
					<div className="panel-heading">
						<p className="eyebrow">Provider Surface</p>
						<h2>Inbound integrations</h2>
					</div>
					<div className="provider-list">
						{loaderData.overview.providers.map((provider) => (
							<div className="provider-card" key={provider.name}>
								<div>
									<h3>{provider.name}</h3>
									<p>{provider.details}</p>
								</div>
								<span className={`badge badge-${provider.status}`}>{provider.status}</span>
							</div>
						))}
					</div>
				</article>

				<article className="panel">
					<div className="panel-heading">
						<p className="eyebrow">Pipeline</p>
						<h2>Processing stages</h2>
					</div>
					<ol className="timeline">
						{loaderData.overview.processingStages.map((stage) => (
							<li key={stage}>{stage}</li>
						))}
					</ol>
				</article>
			</section>
		</main>
	);
}
