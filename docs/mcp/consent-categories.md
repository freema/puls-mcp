# Consent kategorie

Při OAuth flow uživatel zaškrtne, které kategorie nástrojů AI klient dostane. Tyto checkboxy se ukládají do tokenu (CSV `disabled_tools`) a `tools/list` pak vrací jen povolené tooly.

## 7 kategorií

| ID | Label (CZ) | Default ON | Write? | Co odemyká |
|---|---|---|---|---|
| `orders` | Objednávky | ✅ | — | `list_orders`, `get_order`, `list_order_changes` |
| `products` | Produkty | ✅ | — | `list_products`, `get_product` |
| `customers` | Zákazníci | ✅ | — | `list_customers`, `get_customer` |
| `catalog` | Katalog (eshop info) | ✅ | — | `list_stocks`, `list_categories`, `eshop_info` |
| `insights` | Insights (přehledy) | ✅ | — | `sales_summary`, `low_stock`, `top_customers` |
| `write` ⚠️ | Zápisové akce | ❌ | ✅ | mutující tools + `revert_write` (okamžitý zápis + audit, viz [write-tools-and-audit.md](write-tools-and-audit.md)) |
| `memory` | Paměť (preference a kontext) | ✅ | — | `memory_get`, `memory_set`, `memory_forget` |

> Read-only kategorie jsou **defaultně zapnuté**, `write` je **defaultně vypnutá** (strict opt-in).

Definice: [`apps/web/app/routes/auth.mcp-connect.tsx:20`](../../apps/web/app/routes/auth.mcp-connect.tsx) (consent UI) a [`apps/mcp-server/src/puls-mcp.ts:36`](../../apps/mcp-server/src/puls-mcp.ts) (`TOOL_CATEGORIES` mirror).

## UI v consentu

Každá kategorie má v `/auth/mcp-connect`:
- checkbox `<input name="tool_<id>" defaultChecked={defaultOn}>`
- label v češtině (`label`)
- popis (`desc`) — co kategorie umožňuje
- `write` má vizuálně distinktivní badge **"Mění data"**

Příklad UI rendering pro `write`:
```
☐ Zápisové akce  [Mění data]
   Změna stavu objednávky a poznámky u zákazníků. Klient bude moci váš
   eshop měnit, ne jen číst.
```

## Kódování v tokenu

Při schválení (akce `auth.mcp-connect`):
1. Form submit obsahuje `tool_<id>=on` pro každou zaškrtnutou kategorii.
2. Server vyrobí `disabled = ALL_CATEGORIES.filter(id => !enabledIds.has(id))`.
3. Uloží `disabled.join(',')` jako CSV string do `oauth_authorization_codes.disabled_tools`.
4. Při token exchange (`/oauth/token`) se zkopíruje do `oauth_access_tokens.disabled_tools`.

### Sémantika `disabled_tools` hodnoty

| Hodnota | Význam |
|---|---|
| `null` | Legacy token před zavedením consent UI. `parseDisabledTools` to interpretuje jako `Set(['write'])` — tj. všechno read-only ano, write ne. Strict opt-in. |
| `""` (prázdný string) | Modern "nothing disabled" — uživatel zaškrtl úplně všechno. |
| `"write,memory"` | Tyto kategorie jsou disabled. Ostatní enabled. |

Code: [`apps/mcp-server/src/oauth/middleware.ts:119`](../../apps/mcp-server/src/oauth/middleware.ts).

## Server-side filter

Při `createShopMcpServer(shop, db, disabledTools)`:

```ts
if (!disabledTools.has('orders'))    registerOrdersTools(server, shop, db);
if (!disabledTools.has('products'))  registerProductsTools(server, shop, db);
if (!disabledTools.has('customers')) registerCustomersTools(server, shop, db);
if (!disabledTools.has('catalog'))   registerCatalogTools(server, shop, db);
if (!disabledTools.has('insights'))  registerInsightsTools(server, shop, db);

const trialBlocksWrites = tier?.isTrial === true;
if (!disabledTools.has('write') && !trialBlocksWrites) {
  registerWriteTools(server, shop, db);
}

if (!disabledTools.has('memory') && memory !== null) {
  registerMemoryTools(server, shop, db);
}
```

**Důsledky:**
- Tool, který user zakázal → `tools/list` ho **vůbec nevrátí**. Klient o něm ani neví.
- `memory` má **dvojí gate**: consent + `shop_memory` row (memory enabled v dashboardu). Pokud uživatel povolí `memory` ale memory ještě nezapnul, tooly se nezaregistrují (ale vidí v dashboardu možnost zapnout).
- `write` má **trojí gate**: consent + ne-trial tier + **platforma to umí** (capability-driven). `registerWriteTools` registruje každý write nástroj jen když ho `connector.capabilities.writes` deklaruje; platforma bez plné write sady (dnes Upgates) tak kategorii gracefully degraduje a Trial nikdy nedostane write tools v listingu.

## Změna consentu

Token je immutable po vydání — jediný způsob jak změnit consent je:
1. Revoke aktuální token (`/dashboard/:shopId/connections` → tlačítko "Odpojit").
2. Klient si musí udělat nový OAuth flow — projde znovu consent UI s aktuálními checkboxy.

> Není dnes "edit consent" UI — vědomě, aby každá změna scope byla vědomá akce uživatele přes klienta.

## Resources & prompts: NEgated

`registerShopResources(server, shop, db)` a `registerShopPrompts(server, shop)` se volají **vždy**, bez ohledu na consent. Důvod:
- **Resources** vystavují `puls://eshop/info`, `puls://catalog/categories`, `puls://catalog/warehouses` — to jsou static metadata e-shopu, nic víc než `eshop_info` / `list_categories` / `list_stocks` (které jsou v `catalog` kategorii). Pokud user zakázal `catalog`, dostal by data jiným kanálem — efektivně nedává smysl gate vést dvakrát.
- **Prompts** jsou pre-built MCP prompty (templates), žádná data e-shopu.

Pokud bude potřeba gate i toto, bude se přidávat do `disabledTools` setu.
