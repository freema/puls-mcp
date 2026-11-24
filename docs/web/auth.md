# Auth flow

Puls podporuje **dvě cesty** přihlášení:

1. **E-mail magic link** — uživatel zadá e-mail, dostane 6-místný kód, opíše ho na `/login/verify`.
2. **Google OIDC** — single-click sign-in přes Google.

Obě cesty končí stejně: vytvoří se row v `users` (pokud neexistuje) a v `sessions` → `puls_session` HttpOnly cookie → uživatel je in.

## Architektura

```
┌─────────┐     /login (email form)            ┌──────────┐
│  Klient │ ─────────────────────────────────► │  Web AS  │
└────┬────┘     /auth/google → Google OIDC     └──────────┘
     │              │                                │
     │              ▼                                ▼
     │         Google OIDC                     SMTP send
     │              │                                │
     │              │                                ▼
     │              │                          email s kódem
     │              │                                │
     │              ▼                                ▼
     │      /auth/google/callback           /login/verify (code form)
     │              │                                │
     │              └────────────► ensureUser ◄──────┘
     │                                  │
     │                                  ▼
     │                          createUserSession
     │                                  │
     │                                  ▼
     │                          Set-Cookie: puls_session=<token>
     │  ◄───────────────────────────────────────────────────
```

## E-mail magic link

### `GET /login`

[`apps/web/app/routes/login.tsx`](../../apps/web/app/routes/login.tsx)

Loader:
- Pokud `?error=oauth|google|email_unverified|invalid` → zobrazí banner.
- Render: e-mail input + "Pokračovat" submit + Google sign-in button (pokud `AUTH_GOOGLE_ID` env).

Action (POST):
1. Validace e-mailu Zodem.
2. Rate limit (Redis) — max N requestů per IP / e-mail za hodinu.
3. `createEmailLoginCode(email)`:
   - Vyrobí 6-místný numerický kód.
   - SHA-256 hash uloží do `magic_links` s `email`, `expires_at = now+10min`, `attempts = 0`.
   - Pošle e-mail s kódem přes SMTP (`lib/email/send-login-code.server.ts`).
4. `redirect('/login/verify?email=' + email)`.

### `GET /login/verify?email=...`

[`apps/web/app/routes/login.verify.tsx`](../../apps/web/app/routes/login.verify.tsx)

Render: 6× single-char input (auto-advance při typing). Email zobrazený maskovaný (`ad***@example.com`).

Action (POST):
1. Validace `code` (přesně 6 cifer).
2. `consumeEmailLoginCode(email, code)`:
   - SELECT `magic_links` WHERE `email = ? AND expires_at > now() AND attempts < 5`
   - `verifyHash(code, row.codeHash)` → pokud match: DELETE row → return `{ ok: true }`
   - Pokud mismatch: `UPDATE attempts = attempts + 1` → return `{ ok: false }`
3. Pokud success → `ensureUserByEmail(email)` → `createUserSession(userId)` → set cookie + redirect to `?callbackUrl` (default `/dashboard`).

## Google OIDC

### `GET /auth/google`

[`apps/web/app/routes/auth.google.tsx`](../../apps/web/app/routes/auth.google.tsx)

Loader:
1. Validuje, že `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` env exist (jinak `redirect('/login?error=google')`).
2. Generuje `state` (24B hex), uloží do cookie `puls_google_state` (HttpOnly, SameSite=Lax, 10min TTL).
3. Buildne Google OAuth URL (`buildGoogleAuthUrl({ clientId, redirectUri, state })`):
   ```
   https://accounts.google.com/o/oauth2/v2/auth?
     client_id=...
     &redirect_uri=<our_callback>
     &response_type=code
     &scope=openid+email+profile
     &state=<generated>
     &access_type=online
     &prompt=select_account
   ```
4. `302 → google_url`.

### `GET /auth/google/callback`

[`apps/web/app/routes/auth.google.callback.tsx`](../../apps/web/app/routes/auth.google.callback.tsx)

Loader:
1. Read `code` + `state` z query.
2. Read `puls_google_state` cookie. **Compare** — pokud mismatch / missing → `redirect('/login?error=oauth')`.
3. Clear state cookie.
4. `exchangeGoogleAuthCode({ code, redirectUri, clientId, clientSecret })` → `{ access_token, id_token, ... }`.
5. `fetchGoogleUserInfo(access_token)` → `{ sub, email, email_verified, name, picture }`.
6. Pokud `email_verified !== true` → `redirect('/login?error=email_unverified')`.
7. `ensureUserFromGoogle({ email, googleSub: sub })`:
   - Najdi user by `email` nebo `google_sub`.
   - Pokud chybí: insert nového.
   - Pokud existuje user by email ale nemá `google_sub`: link (`UPDATE users SET google_sub = ?`).
8. `createUserSession(userId)` → set cookie + redirect to `?callbackUrl` (default `/dashboard`).

## Session

### Cookie `puls_session`
| Atribut | Hodnota |
|---|---|
| Name | `puls_session` |
| Value | 96-hex token (48B random) |
| HttpOnly | yes |
| Path | `/` |
| Max-Age | 30 dnů (rolling refresh při každém requestu) |
| SameSite | `None` v prod (kvůli `/settings/:shopId` iframe v Shoptet adminu pod `*.myshoptet.com`); `Lax` v dev (HTTP localhost) |
| Secure | yes v prod (vyžadováno pro SameSite=None); no v dev |

Code: [`apps/web/app/lib/auth/session.server.ts:30`](../../apps/web/app/lib/auth/session.server.ts).

### `getSessionUser(db, request)`
1. Read cookie.
2. SELECT join sessions+users WHERE `token=? AND expires_at>now()`.
3. Pokud match → **rolling refresh** (`UPDATE expires_at = now()+30d`) → return `{ id, email }`.
4. Pokud miss → `null`.

### `requireSessionUser(db, request)`
- Stejný lookup, ale pokud `null` → `throw redirect('/login')`.

### `destroySession(db, request)`
- DELETE row → return clear-cookie header.

## `/auth/logout`

[`apps/web/app/routes/auth.logout.tsx`](../../apps/web/app/routes/auth.logout.tsx)

Action (POST): `destroySession(db, request)` → `302 → /` se `Set-Cookie: puls_session=; Max-Age=0`.

Loader: `redirect('/')` (GET na `/auth/logout` jen redirect home, prevent CSRF).

## `/nastaveni`

[`apps/web/app/routes/nastaveni.tsx`](../../apps/web/app/routes/nastaveni.tsx)

Loader: `requireSessionUser` → load `users` row + `listShopsForEmail(user.email)` + `isAdminEmail(user.email)`.

Render:
- **User card**: e-mail, sign-in method (e-mail nebo Google), join date.
- **Shops list**: kde je user majitel, link na `/dashboard/:shopId`.
- **Admin badge**: pokud admin, link na `/admin`.
- **Logout** form.
- **Delete account** form (s confirm modal) → POST na `/nastaveni/delete-account`.

## `/nastaveni/delete-account`

[`apps/web/app/routes/nastaveni.delete-account.tsx`](../../apps/web/app/routes/nastaveni.delete-account.tsx)

Action (POST):
1. `requireSessionUser` → user.
2. `destroySession` → clear cookie.
3. Cascade delete:
   - `DELETE FROM sessions WHERE user_id = ?`
   - `DELETE FROM oauth_access_tokens WHERE user_id = ?`
   - `DELETE FROM oauth_authorization_codes WHERE user_id = ?`
   - `DELETE FROM users WHERE id = ?` (cascade: shopMemoryItems? NE — memory je per-shop)
4. `302 → /?account_deleted=1`.

> **Pozn.**: `shops` se nemažou (vlastník odešel ale shop existuje na Shoptet straně). Cizí pohled by si shop musel "převzít" (TODO: feature).

## Test bypass

V e2e lze obejít magic link / Google flow přes přímý DB session insert. Detail v [../testing/login-bypass.md](../testing/login-bypass.md).

```ts
const { token } = await seedBrowserSession({ databaseUrl, email: 'foo@example.com' });
context.addCookies([{ name: 'puls_session', value: token, ... }]);
```
