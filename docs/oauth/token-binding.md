# Token binding — token = (user, shop, scope, disabled_tools)

Bearer token je v Puls **plně self-contained projekce práv** — stačí ho hashnout, najít v DB a víme přesně, co klient smí.

## Co token nese

```ts
// oauth_access_tokens row
{
  id: cuid,
  token_hash: sha256(plain_token).hex,    // search key
  user_id: <users.id>,                    // kdo schválil
  shop_id: <shops.id>,                    // ke kterému shopu se vztahuje
  oauth_client_id: <oauth_clients.id> | null,  // který MCP klient si ho vyzvednul
  scope: 'mcp:read mcp:write' | null,     // OAuth scope (informativní, naše tooly to nečtou)
  disabled_tools: 'write,memory' | '' | null,  // CSV consent kategorií
  expires_at: <created_at + 180d>,
  revoked_at: null,
  last_used_at: <touched on each /mcp call>,
  created_at: <token issuance>,
}
```

## Lookup při MCP volání

[`apps/mcp-server/src/oauth/middleware.ts:34`](../../apps/mcp-server/src/oauth/middleware.ts):

```ts
async function validateBearer(db, bearer): Promise<AuthedToken | null> {
  const tokenHash = sha256(bearer).hex;
  const [row] = await db.select().from(oauthAccessTokens)
    .where(and(
      eq(tokenHash, ...),
      isNull(revokedAt),
      gt(expiresAt, now()),
    )).limit(1);
  if (!row) return null;

  // Touch last_used_at (informativní, pro audit)
  await db.update(...).set({ lastUsedAt: now });

  return {
    type: 'oauth',
    userId: row.userId,
    shopId: row.shopId,
    scope: row.scope,
    disabledTools: row.disabledTools,
  };
}
```

## Switch shopu = nový OAuth flow

Token je **immutable**:
- Nejde edit shopu (token je vázaný na konkrétní `shop_id`).
- Nejde edit consent (`disabled_tools` je copy z auth code, copy je final).
- Nejde refresh (žádný refresh token).

Pokud user má **víc shopů** a chce klienta překlopit z shopu A na shop B:
1. V Claude Desktopu zruší MCP server (smaže token na své straně).
2. Přidá MCP server znovu (Claude pošle nový OAuth flow).
3. V consent UI vybere shop B → dostane nový token vázaný na B.

> Bug-by-design: `/dashboard/:shopId/connections` umožňuje user "Odpojit" konkrétní token (nastaví `revoked_at`). Není UI na "edit shop binding existujícího tokenu" — vědomě, aby každá změna byla vědomá akce přes MCP klienta.

## `disabled_tools` semantics

| Hodnota | Význam |
|---|---|
| `null` | Legacy token (před zavedením consent UI). `parseDisabledTools` to interpretuje jako `Set(['write'])`. Strict opt-in. |
| `""` | Modern "vše enabled" — uživatel zaškrtl všech 7 kategorií. |
| `"write"` | Disabled jen `write`. |
| `"write,memory"` | Disabled `write` a `memory`. |
| `"orders,products,..."` | Multi-disable, comma-separated. |

Code: [`apps/mcp-server/src/oauth/middleware.ts:119`](../../apps/mcp-server/src/oauth/middleware.ts).

## Multi-tenancy guarantee

Token nese **jeden** `shop_id`. MCP server pak v factory volá `loadShopById(shopId)` a vyrobí `McpServer` instanci jen pro ten shop. Žádný tool handler nemá přístup k `db` queries cross-shop ani parameter na `shopId` od klienta.

Tj. **token A klienta na shop X nikdy neuvidí data shopu Y**, ani když je oba shopy patří stejnému user.

## Revocation

| Akce | Effekt |
|---|---|
| User klikne "Odpojit" v `/dashboard/:shopId/connections` | `UPDATE oauth_access_tokens SET revoked_at = now() WHERE id = ?` |
| User smaže account (`/nastaveni/delete-account`) | `DELETE FROM oauth_access_tokens WHERE user_id = ?` (cascade z `users`) |
| Shop uninstall | `DELETE FROM oauth_access_tokens WHERE shop_id = ?` (cascade z `shops`) |
| Token expiruje | `validateBearer` ho vrátí jako `null` (filter `expires_at > now()`) |

> Klient po revocation pošle další `/mcp` call → 401 + `WWW-Authenticate: ... error="invalid_token"` → MCP klient pozná, že je třeba re-auth, spustí discovery znovu.

## Více e-shopů pod jedním účtem (multi-platform)

Token je vázaný na **právě jeden shop** (`shop_id`), platforma shopu v tokenu není — resolvuje se až za běhu ze `shops.platform` přes connector registry ([`apps/mcp-server/src/connector-registry.ts`](../../apps/mcp-server/src/connector-registry.ts)).

Prakticky pro uživatele se 2 e-shopy (klidně Shoptet + Upgates): přidá si v Claude náš MCP server **dvakrát** (např. jako „Puls – shop A" a „Puls – shop B"), při každé autorizaci vybere v consent shop-pickeru jiný e-shop — picker ukazuje všechny jeho shopy obou platforem s labelem platformy ([`auth.mcp-connect.tsx`](../../apps/web/app/routes/auth.mcp-connect.tsx)). **Stejná URL, stejný účet, dva tokeny.** Žádná druhá instance serveru neexistuje a nesmí existovat.

Limit hlídá `maxShopsPerAccount` z tarifu; ceník je platform-agnostic — platí se za Puls (za e-shop), ne za platformu.

## Token rotation strategy

Dnes: žádná. Token žije 180 dnů, pak klient jede consent znovu (a uvidí aktuální consent UI — pokud jsme přidali kategorii, user ji explicitně schválí).

Důvod: pro MCP usage (žije v dlouhotrvajících session-like klientech jako Claude Desktop) je rotation nepříjemná, lepší dlouhý TTL + manuální revoke.

## Cross-reference

| Téma | Doc |
|---|---|
| Jak `disabled_tools` ovlivňuje `tools/list` | [../mcp/consent-categories.md](../mcp/consent-categories.md) |
| Jak Bearer middleware vede dál | [../mcp/overview.md#authorization](../mcp/overview.md#authorization) |
| Jak se token vydává | [token-exchange.md](token-exchange.md) |
| Jak user revokuje | [../web/client-dashboard.md#connections](../web/client-dashboard.md) |
