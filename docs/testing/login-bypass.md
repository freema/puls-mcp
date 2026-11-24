# Login bypass (DB session seeding)

V e2e testech (a v lokálním debug procházení web UI) je magic link / Google OIDC flow nepraktický — kód jde do SMTP, Google OIDC vyžaduje real account. Místo toho **přímo zapíšeme session row do DB** a setneme cookie `puls_session`.

## Mechanismus

1. Insert `users` row pokud chybí (`INSERT IGNORE` style — najít by email nebo create).
2. Insert `sessions` row s `token = randomBytes(32).hex` a `expires_at = now() + 30d`.
3. Set browser cookie `puls_session=<token>` s `HttpOnly`, `SameSite=Lax`, `Path=/`.

Server side `getSessionUser` lookupuje cookie token v DB → najde row → vrátí user. Nezná žádný rozdíl mezi "session vyrobená přes login" a "session seeded".

## Helper v testech

[`tests-e2e/helpers/session.ts`](../../tests-e2e/helpers/session.ts):

```ts
export async function seedBrowserSession(args: {
  databaseUrl: string;
  email: string;
}): Promise<{ token: string }> {
  const client = new pg.Client({ connectionString: args.databaseUrl });
  await client.connect();
  try {
    const email = args.email.trim().toLowerCase();

    // 1. Find or create user
    const existing = await client.query<{ id: string }>(
      `select id from users where email = $1`,
      [email]
    );
    let userId = existing.rows[0]?.id;
    if (!userId) {
      userId = randomBytes(16).toString('hex');
      await client.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
    }

    // 2. Wipe & insert fresh session
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await client.query(`delete from sessions where user_id = $1`, [userId]);
    await client.query(
      `insert into sessions (id, user_id, token, expires_at) values ($1, $2, $3, $4)`,
      [randomBytes(12).toString('hex'), userId, token, expiresAt]
    );

    return { token };
  } finally {
    await client.end();
  }
}
```

[`tests-e2e/helpers/seed-session-cookie.ts:loginViaSeed`](../../tests-e2e/helpers/seed-session-cookie.ts) wrapne to pro Playwright:

```ts
const { token } = await seedBrowserSession({ databaseUrl, email });
await context.addCookies([
  {
    name: 'puls_session',
    value: token,
    domain: new URL(baseUrlWeb).hostname,    // 'app' v compose, 'localhost' z hostu
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  },
]);
```

## Lokální použití (mimo Playwright)

Pokud chceš lokálně procházet UI bez login flow:

```bash
# 1. Najdi nebo vyrob user
PGPASSWORD=puls docker exec puls-postgres psql -U puls -d puls -tA \
  -c "select id from users where email='ja@example.com';"

# (pokud miss, vytvoř)
USER_ID=$(openssl rand -hex 16)
PGPASSWORD=puls docker exec puls-postgres psql -U puls -d puls -tA \
  -c "insert into users(id,email) values('$USER_ID','ja@example.com');"

# 2. Vyrob session
TOKEN=$(openssl rand -hex 32)
SESSION_ID=$(openssl rand -hex 12)
PGPASSWORD=puls docker exec puls-postgres psql -U puls -d puls -tA \
  -c "delete from sessions where user_id='$USER_ID';
      insert into sessions(id,user_id,token,expires_at)
      values('$SESSION_ID','$USER_ID','$TOKEN', now() + interval '7 days');"

# 3. V browseru otevři DevTools > Application > Cookies > localhost
#    Přidej cookie: name=puls_session, value=$TOKEN, path=/, HttpOnly
#    Refresh /dashboard → jsi přihlášený
```

Nebo s `curl`:
```bash
curl -H "Cookie: puls_session=$TOKEN" http://localhost:13000/dashboard
```

## Admin bypass

Pro admin role (`/admin/*`) musí být email v `ADMIN_EMAIL` env (default `admin@example.com`). Buď:
- Použij `admin@example.com` jako email v seed.
- Nebo pro test override `ADMIN_EMAIL=test-admin@example.test` v compose env před `task e2e`.

## Bezpečnost

- **Dev only mechanismus.** V production nedrží žádný open endpoint, který by umožnil seed cookie zvenku — všechno jde přes přímý DB insert (vyžaduje DB credentials).
- Pokud bys chtěl "impersonate" feature pro support, přidat dedicated `/admin/impersonate?userId=...` endpoint s audit logem (TODO, jen pokud bude potřeba).

## Limitations

- **Magic-link UI flow se netestuje** — neexistuje deterministický způsob jak kód vytáhnout (hashed v Redis). Pokud bude potřeba, přidat dev-only endpoint `/__test/last-mail-code?email=...` (jen v non-prod) nebo MailHog v compose.
- **Google OIDC se netestuje** — vyžadovalo by Google service account a mock IdP. Místo toho test seed-session pokrývá funkčnost po loginu, samotný OIDC je jen redirect.
