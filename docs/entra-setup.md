# Entra SSO Setup

This app now uses a server-side OpenID Connect authorization code flow for `/admin`.

## What the app expects

Required Worker bindings:

- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `AUTH_SESSION_SECRET`

Optional Worker bindings:

- `ADMIN_ALLOWED_EMAILS`
- `ADMIN_ALLOWED_DOMAINS`

## Recommended Entra app registration

Create a new app registration in Microsoft Entra ID with:

- Platform type: `Web`
- Supported account types: `Accounts in this organizational directory only`
- Redirect URI for local dev: `http://localhost:5173/auth/callback`
- Redirect URI for production: `https://<your-production-host>/auth/callback`
- Front-channel logout URL: `http://localhost:5173/` for local, then your production root URL

This implementation uses the authorization code flow, so it does not rely on implicit-flow tokens in the browser.

## Token and scope behavior

The app requests:

- `openid`
- `profile`
- `email`
- `offline_access`

The Worker validates the returned ID token, creates a signed session cookie, and protects `/admin`.

## Local secret configuration

Set the confidential values with Wrangler:

```bash
npx wrangler secret put ENTRA_CLIENT_SECRET
npx wrangler secret put AUTH_SESSION_SECRET
```

Add the non-secret values under `vars` in `wrangler.json` or your environment-specific config:

```json
{
  "vars": {
    "ENTRA_TENANT_ID": "your-tenant-guid",
    "ENTRA_CLIENT_ID": "your-app-client-id",
    "ADMIN_ALLOWED_EMAILS": "admin1@contoso.com,admin2@contoso.com",
    "ADMIN_ALLOWED_DOMAINS": "contoso.com"
  }
}
```

## Notes

- If both `ADMIN_ALLOWED_EMAILS` and `ADMIN_ALLOWED_DOMAINS` are blank, any successfully authenticated Entra user in the configured tenant can access `/admin`.
- `ADMIN_ALLOWED_EMAILS` and `ADMIN_ALLOWED_DOMAINS` are an interim control until tenant-scoped app roles and user membership are wired into the app.
