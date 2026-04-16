import { createRemoteJWKSet, jwtVerify } from "jose";

import type { WorkerEnv } from "../config/env";
import { getEntraConfig } from "./config";
import {
	clearFlowCookie,
	clearSessionCookie,
	createFlowCookie,
	createSessionCookie,
	readFlowFromRequest,
	readSessionFromRequest,
	type AuthFlowState,
	type AuthUser,
} from "./session";

export class AuthError extends Error {
	readonly status: number;

	constructor(message: string, status = 401) {
		super(message);
		this.name = "AuthError";
		this.status = status;
	}
}

export async function startLogin(request: Request, env: WorkerEnv): Promise<Response> {
	const config = getRequiredConfig(env);
	const secure = isSecureRequest(request);
	const url = new URL(request.url);
	const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));
	const state = randomString();
	const nonce = randomString();
	const codeVerifier = randomString(64);
	const codeChallenge = await sha256Base64Url(codeVerifier);
	const flow: AuthFlowState = {
		state,
		nonce,
		codeVerifier,
		returnTo,
		expiresAt: Math.floor(Date.now() / 1000) + 10 * 60,
	};

	const authorizeUrl = new URL(
		`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`,
	);
	authorizeUrl.searchParams.set("client_id", config.clientId);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("redirect_uri", getRedirectUri(request));
	authorizeUrl.searchParams.set("response_mode", "query");
	authorizeUrl.searchParams.set("scope", "openid profile email offline_access");
	authorizeUrl.searchParams.set("state", state);
	authorizeUrl.searchParams.set("nonce", nonce);
	authorizeUrl.searchParams.set("code_challenge", codeChallenge);
	authorizeUrl.searchParams.set("code_challenge_method", "S256");

	return new Response(null, {
		status: 302,
		headers: new Headers({
			Location: authorizeUrl.toString(),
			"Set-Cookie": await createFlowCookie(flow, config, secure),
		}),
	});
}

export async function handleCallback(request: Request, env: WorkerEnv): Promise<Response> {
	const config = getRequiredConfig(env);
	const secure = isSecureRequest(request);
	const flow = await readFlowFromRequest(request, config);
	if (!flow) {
		throw new AuthError("Sign-in session expired. Start the login flow again.", 400);
	}

	const url = new URL(request.url);
	const error = url.searchParams.get("error");
	if (error) {
		throw new AuthError(url.searchParams.get("error_description") ?? error, 400);
	}

	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	if (!state || state !== flow.state || !code) {
		throw new AuthError("Invalid sign-in callback. State or authorization code missing.", 400);
	}

	const tokens = await exchangeCodeForTokens(request, config, code, flow.codeVerifier);
	const user = await verifyIdToken(config, tokens.id_token, flow.nonce);
	enforceAdminAccess(config, user);

	const headers = new Headers({
		Location: new URL(flow.returnTo, request.url).toString(),
	});
	headers.append("Set-Cookie", await createSessionCookie(user, config, secure));
	headers.append("Set-Cookie", clearFlowCookie(secure));

	return new Response(null, {
		status: 302,
		headers,
	});
}

export function logout(request: Request, env: WorkerEnv): Response {
	const config = getEntraConfig(env);
	const secure = isSecureRequest(request);
	const postLogoutRedirectUri = new URL("/", request.url).toString();

	if (!config) {
		const headers = new Headers({
			Location: postLogoutRedirectUri,
		});
		headers.append("Set-Cookie", clearSessionCookie(secure));
		headers.append("Set-Cookie", clearFlowCookie(secure));

		return new Response(null, {
			status: 302,
			headers,
		});
	}

	const logoutUrl = new URL(
		`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/logout`,
	);
	logoutUrl.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);

	const headers = new Headers({
		Location: logoutUrl.toString(),
	});
	headers.append("Set-Cookie", clearSessionCookie(secure));
	headers.append("Set-Cookie", clearFlowCookie(secure));

	return new Response(null, {
		status: 302,
		headers,
	});
}

export async function getAuthenticatedUser(
	request: Request,
	env: WorkerEnv,
): Promise<AuthUser | null> {
	const config = getEntraConfig(env);
	if (!config) {
		return null;
	}

	const user = await readSessionFromRequest(request, config);
	if (!user) {
		return null;
	}

	return user;
}

export async function requireAdminUser(
	request: Request,
	env: WorkerEnv,
): Promise<AuthUser | null> {
	const config = getEntraConfig(env);
	if (!config) {
		return null;
	}

	const user = await readSessionFromRequest(request, config);
	if (!user) {
		return null;
	}

	enforceAdminAccess(config, user);
	return user;
}

function getRequiredConfig(env: WorkerEnv) {
	const config = getEntraConfig(env);
	if (!config) {
		throw new AuthError(
			"Entra authentication is not configured. Set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, and AUTH_SESSION_SECRET.",
			500,
		);
	}

	return config;
}

async function exchangeCodeForTokens(
	request: Request,
	config: NonNullable<ReturnType<typeof getEntraConfig>>,
	code: string,
	codeVerifier: string,
) {
	const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
	const response = await fetch(tokenUrl, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			code_verifier: codeVerifier,
			grant_type: "authorization_code",
			redirect_uri: getRedirectUri(request),
			scope: "openid profile email offline_access",
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new AuthError(`Token exchange failed: ${body}`, 401);
	}

	return (await response.json()) as {
		id_token: string;
		access_token: string;
	};
}

async function verifyIdToken(
	config: NonNullable<ReturnType<typeof getEntraConfig>>,
	idToken: string,
	expectedNonce: string,
): Promise<AuthUser> {
	let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
	try {
		const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
		const jwks = createRemoteJWKSet(
			new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`),
		);
		const verified = await jwtVerify(idToken, jwks, {
			audience: config.clientId,
			issuer,
		});
		payload = verified.payload;
	} catch (error) {
		throw new AuthError(
			error instanceof Error ? `ID token validation failed: ${error.message}` : "ID token validation failed.",
			401,
		);
	}

	if (payload.nonce !== expectedNonce) {
		throw new AuthError("Invalid login nonce received from Entra.", 401);
	}

	const email =
		stringClaim(payload.email) ??
		stringClaim(payload.preferred_username) ??
		stringClaim(payload.upn);

	if (!email) {
		throw new AuthError("Authenticated Entra user did not include an email claim.", 403);
	}

	const oid = stringClaim(payload.oid);
	const tid = stringClaim(payload.tid);
	const exp = typeof payload.exp === "number" ? payload.exp : 0;
	if (!oid || !tid || !exp) {
		throw new AuthError("Authenticated Entra token was missing required claims.", 403);
	}

	return {
		oid,
		tid,
		email,
		name: stringClaim(payload.name) ?? email,
		preferredUsername: stringClaim(payload.preferred_username) ?? email,
		exp,
	};
}

function enforceAdminAccess(
	config: NonNullable<ReturnType<typeof getEntraConfig>>,
	user: AuthUser,
) {
	if (
		config.allowedEmails.length > 0 &&
		!config.allowedEmails.includes(user.email.toLowerCase())
	) {
		throw new AuthError("Signed-in user is not in the admin email allowlist.", 403);
	}

	if (config.allowedDomains.length > 0) {
		const domain = user.email.split("@")[1]?.toLowerCase();
		if (!domain || !config.allowedDomains.includes(domain)) {
			throw new AuthError("Signed-in user is not in an allowed admin domain.", 403);
		}
	}
}

function sanitizeReturnTo(returnTo: string | null): string {
	if (!returnTo || !returnTo.startsWith("/")) {
		return "/admin";
	}

	return returnTo;
}

function getRedirectUri(request: Request): string {
	return new URL("/auth/callback", request.url).toString();
}

function isSecureRequest(request: Request): boolean {
	return new URL(request.url).protocol === "https:";
}

function randomString(length = 32): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringClaim(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}
