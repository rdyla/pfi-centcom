import type { EntraConfig } from "./config";

const SESSION_COOKIE = "pfi_session";
const FLOW_COOKIE = "pfi_auth_flow";

export interface AuthUser {
	oid: string;
	tid: string;
	email: string;
	name: string;
	preferredUsername: string;
	exp: number;
}

export interface AuthFlowState {
	state: string;
	nonce: string;
	codeVerifier: string;
	returnTo: string;
	expiresAt: number;
}

export async function createSessionCookie(
	user: AuthUser,
	config: EntraConfig,
	secure: boolean,
): Promise<string> {
	const token = await signValue(user, config.sessionSecret);
	const maxAge = Math.max(60, user.exp - Math.floor(Date.now() / 1000));

	return serializeCookie(SESSION_COOKIE, token, {
		httpOnly: true,
		maxAge,
		path: "/",
		sameSite: "Lax",
		secure,
	});
}

export async function createFlowCookie(
	flow: AuthFlowState,
	config: EntraConfig,
	secure: boolean,
): Promise<string> {
	const token = await signValue(flow, config.sessionSecret);
	const maxAge = Math.max(60, flow.expiresAt - Math.floor(Date.now() / 1000));

	return serializeCookie(FLOW_COOKIE, token, {
		httpOnly: true,
		maxAge,
		path: "/auth",
		sameSite: "Lax",
		secure,
	});
}

export function clearSessionCookie(secure: boolean): string {
	return serializeCookie(SESSION_COOKIE, "", {
		httpOnly: true,
		maxAge: 0,
		path: "/",
		sameSite: "Lax",
		secure,
	});
}

export function clearFlowCookie(secure: boolean): string {
	return serializeCookie(FLOW_COOKIE, "", {
		httpOnly: true,
		maxAge: 0,
		path: "/auth",
		sameSite: "Lax",
		secure,
	});
}

export async function readSessionFromRequest(
	request: Request,
	config: EntraConfig,
): Promise<AuthUser | null> {
	const cookieValue = getCookieValue(request.headers.get("cookie"), SESSION_COOKIE);
	if (!cookieValue) {
		return null;
	}

	const session = await verifySignedValue<AuthUser>(cookieValue, config.sessionSecret);
	if (!session) {
		return null;
	}

	if (session.exp <= Math.floor(Date.now() / 1000)) {
		return null;
	}

	return session;
}

export async function readFlowFromRequest(
	request: Request,
	config: EntraConfig,
): Promise<AuthFlowState | null> {
	const cookieValue = getCookieValue(request.headers.get("cookie"), FLOW_COOKIE);
	if (!cookieValue) {
		return null;
	}

	const flow = await verifySignedValue<AuthFlowState>(cookieValue, config.sessionSecret);
	if (!flow) {
		return null;
	}

	if (flow.expiresAt <= Math.floor(Date.now() / 1000)) {
		return null;
	}

	return flow;
}

function serializeCookie(
	name: string,
	value: string,
	options: {
		httpOnly: boolean;
		maxAge: number;
		path: string;
		sameSite: "Lax" | "Strict" | "None";
		secure: boolean;
	},
) {
	return [
		`${name}=${value}`,
		`Path=${options.path}`,
		`Max-Age=${options.maxAge}`,
		"HttpOnly",
		`SameSite=${options.sameSite}`,
		options.secure ? "Secure" : "",
	]
		.filter(Boolean)
		.join("; ");
}

function getCookieValue(cookieHeader: string | null, name: string): string | null {
	if (!cookieHeader) {
		return null;
	}

	for (const part of cookieHeader.split(";")) {
		const trimmed = part.trim();
		if (trimmed.startsWith(`${name}=`)) {
			return trimmed.slice(name.length + 1);
		}
	}

	return null;
}

async function signValue(value: unknown, secret: string): Promise<string> {
	const payload = base64UrlEncode(JSON.stringify(value));
	const signature = await sign(payload, secret);
	return `${payload}.${signature}`;
}

async function verifySignedValue<T>(token: string, secret: string): Promise<T | null> {
	const [payload, signature] = token.split(".");
	if (!payload || !signature) {
		return null;
	}

	const expected = await sign(payload, secret);
	if (!timingSafeEqual(signature, expected)) {
		return null;
	}

	try {
		return JSON.parse(base64UrlDecode(payload)) as T;
	} catch {
		return null;
	}
}

async function sign(input: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
	return bytesToBase64Url(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let result = 0;
	for (let index = 0; index < a.length; index += 1) {
		result |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return result === 0;
}

function base64UrlEncode(value: string): string {
	return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlDecode(value: string): string {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "===".slice((normalized.length + 3) % 4);
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
