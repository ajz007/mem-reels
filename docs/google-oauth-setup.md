# Memory Reels Google OAuth setup

Create a **separate** Google OAuth web client for Memory Reels. Do not reuse the Resume Analyzer callback or client secret.

1. In Google Cloud Console, add `http://127.0.0.1:8787/api/auth/google/callback` as the local authorized redirect URI.
2. For each deployed environment, add only that environment's HTTPS callback: `https://<memory-reels-domain>/api/auth/google/callback`.
3. Keep the client secret in the API runtime's secret manager. Never put it in `VITE_*`, browser code, Git, or logs.
4. Set `AUTH_MODE=google` and provide the three `GOOGLE_*` variables shown in `.env.example` through the local shell or deployment secret manager.

The Phase 1 server uses OAuth state and PKCE, issues a same-origin HttpOnly session cookie, and maps a Google subject to `google:<sub>`. Its in-memory session store is for local development only; replace it with durable server-side session storage before deployment.
