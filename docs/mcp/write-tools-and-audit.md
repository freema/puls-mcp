# Write tools — okamžitý zápis + audit + revert

Write tooly zapisují **okamžitě (synchronně)** — žádná schvalovací fronta, žádný `auto_apply`, žádný cron. Každý zápis se před provedením načte (BEFORE stav), po provedení spočítá AFTER stav a vše se zaloguje do tabulky `write_log` (audit log se statusem `applied | reverted | failed`). Provedený zápis lze vrátit nástrojem `revert_write` (obnoví BEFORE stav → status `reverted`).

> **Velký refaktor (big-bang, 2026-06):** předchozí model `pending_writes` (fronta `pending → approved → executed`, `auto_apply` bypass pro nejvyšší tarif, in-process worker `executeApprovedWrites`, UI `/approvals`) byl **kompletně zrušen**. Migrace `0012_brief_bishop` dropla `pending_writes` a vytvořila `write_log`. Soubor `apps/web/app/lib/cron/pending-writes.server.ts` a routy `dashboard.$shopId.approvals.*` byly smazány.

Code: [`apps/mcp-server/src/tools/writes.ts`](../../apps/mcp-server/src/tools/writes.ts), revert [`apps/mcp-server/src/tools/revert.ts`](../../apps/mcp-server/src/tools/revert.ts), UI [`apps/web/app/routes/dashboard.$shopId.write-history*.tsx`](../../apps/web/app/routes/).

## Dvě pojistky před zápisem

1. **`confirm: "yes"`** — Zod `literal('yes')` + runtime guard. Pokud chybí nebo není přesně `"yes"`, tool hard-failne s `Refusing to write: confirm must be exactly "yes".`. Brání náhodnému zápisu z LLM (např. když user řekne „co kdyby…").
2. **Tier gating (anti-freeride)** — write tooly se **vůbec neregistrují** na trial tieru. Gate běží na jednom místě v `createShopMcpServer` (`puls-mcp.ts`) přes `trialBlocksWrites` v době registrace; `registerWriteTools` se pro trial nezavolá. Trial tedy write tooly nemá ani v `tools/list`.

Žádný runtime „reject podle tieru" už neexistuje — buď je tool zaregistrovaný (placený tier + povolená `write` kategorie + platforma to umí), nebo není vidět vůbec.

## Capability-driven registrace

Každý write nástroj se registruje **jen když ho platforma deklaruje** v `connector.capabilities.writes` (plochá boolean mapa). Platforma bez write capability (`connector.writes === undefined`) nezaregistruje žádný write nástroj — kategorie `write` gracefully degraduje.

```ts
// apps/mcp-server/src/tools/writes.ts
if (!connector.writes) return;                 // platforma write neumí
const w = connector.capabilities.writes;
if (w.updateOrderStatus)  registerOrderStatusTool(...);
if (w.createCustomerNote) registerCustomerNoteTool(...);
if (w.updateProduct)      registerUpdateProductTool(...);
if (w.setActionPrice)     registerActionPriceTool(...);
if (w.createVoucher)      registerVoucherTool(...);
if (w.updateStock)        registerStockTool(...);
if (w.bulkUpdateProducts) registerBulkUpdateProductsTool(...);
registerRevertTool(...);                        // vždy, když platforma umí writes
```

> Shoptet má dnes plnou write sadu (všechny flagy `true`). Upgates zapíná write nástroje **postupně per-capability** podle toho, co je ověřeno proti reálnému API (např. `setActionPrice`/`createCustomerNote` jsou na Upgates zatím `false` — neregistrují se).

## Tooly v kategorii `write`

| Tool | Co dělá | Reverzibilní? |
|---|---|---|
| `update_order_status` | Změna statusu objednávky (+ optional comment) | ✅ obnoví původní status |
| `create_customer_note` | Přidá interní poznámku k zákazníkovi | ❌ poznámku nelze odebrat |
| `update_product` | Update name/description/priceWithVat/visibility/ean/weight/availability/manufacturer/images | ✅ obnoví původní pole (mimo obrázků) |
| `set_action_price` | Akční cena (+ validFrom/validTo) | ✅ obnoví původní cenu |
| `create_voucher` | Vytvořit slevový voucher (% nebo absolute) | ⚠️ deaktivace, kde to platforma umí (jinak ručně) |
| `update_stock` | Set stock quantity (absolute) na konkrétním stockId | ✅ obnoví původní množství |
| `bulk_update_products` | Patches na max 50 produktů; **každý item = samostatný `write_log` řádek** `tool:'update_product'` (revertovatelný zvlášť) | ✅ per-item |
| `revert_write` | Vrátí dříve provedený zápis dle `write_log_id` | — |

**Společný argument všech write nástrojů:** `confirm: "yes"` (viz výše). `auto_apply` **neexistuje**.

## Tool response shape

Úspěšný zápis (okamžitý):
```json
{
  "ok": true,
  "applied": "immediate",
  "write_log_id": "abc123…",
  "result": { /* platform API response */ }
}
```

`bulk_update_products` vrací per-item výsledky:
```json
{
  "ok": true,
  "applied": "immediate",
  "results": [
    { "guid": "…", "status": "ok",    "write_log_id": "…", "data": {…} },
    { "guid": "…", "status": "error", "write_log_id": "…", "error": "…" }
  ]
}
```

Chyba (selhání API nebo chybějící `confirm`) → MCP error response (`isError: true`). Selhaný API zápis se **i tak zaloguje** do `write_log` se statusem `failed` (a `error` textem) — kvůli auditu.

## Tabulka `write_log`

Migrace `0012_brief_bishop`. Schema v [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts).

| Pole | Význam |
|---|---|
| `id` | cuid2 PK |
| `shop_id` | FK `shops` (ON DELETE CASCADE) |
| `tool` | název MCP toolu (`update_product`, `update_order_status`, …); bulk loguje pod `update_product` |
| `args` | JSONB sanitizovaný vstup (bez `confirm`) |
| `before` | JSONB stav PŘED zápisem (z GET před voláním; `null` pokud GET nešel nebo u `create_voucher`) |
| `after` | JSONB stav PO zápisu (API response); `null` při `failed` |
| `status` | enum `write_log_status`: `applied` (default) \| `reverted` \| `failed` |
| `result` | JSONB raw platform API response |
| `error` | text při `failed` |
| `created_at` | timestamp zápisu |
| `reverted_at` | timestamp revertu (`null` dokud nereverted) |

Indexy: `(shop_id, created_at DESC)` a `(status, created_at DESC)`.

## Revert — `revert_write`

Code: [`apps/mcp-server/src/tools/revert.ts`](../../apps/mcp-server/src/tools/revert.ts).

Postup:
1. Načti `write_log` řádek a ověř, že patří tomuto shopu.
2. Revert jde **jen u `applied`** záznamů (`reverted`/`failed` nelze vracet).
3. Dispatch dle `row.tool` → obnov BEFORE stav přes connector.
4. Přepni status na `reverted`, nastav `reverted_at`.

Reverzibilita per nástroj:

| Tool | Revert akce |
|---|---|
| `update_order_status` | `updateOrderStatus({ code, status: before.status })` |
| `update_product` | `updateProduct({ guid, patch })` kde `patch = mapBeforeToPatch(before)` |
| `update_stock` | `updateStock({ guid, stockId, quantity: before.stock })` |
| `set_action_price` | `setActionPrice({ guid, price: original price z before })` |
| `create_customer_note` | **nelze** — poznámku nelze odebrat (srozumitelná chyba) |
| `create_voucher` | preferuje **deaktivaci** voucheru (`active_yn=false`), pokud ji connector exportuje (Upgates `deactivateVoucher`); jinak srozumitelná chyba „deaktivujte ručně" (Shoptet) |

### `mapBeforeToPatch` — POZOR na duplicitu

Funkce, která z BEFORE stavu produktu sestaví `ProductPatch` (name / description / priceWithVat / visibility / ean / weight / availabilityLabel / manufacturer), je **duplikovaná na dvou místech**:

- MCP nástroj: [`apps/mcp-server/src/tools/revert.ts`](../../apps/mcp-server/src/tools/revert.ts)
- Web dashboard tlačítko „Vrátit": [`apps/web/app/routes/dashboard.$shopId.write-history.$id.tsx`](../../apps/web/app/routes/dashboard.$shopId.write-history.$id.tsx)

**Při změně mapování je nutné synchronizovat OBA soubory.** `addImageUrls`/`mainImageUrl` jsou write-only — BEFORE stav nenese URL obrázků jako patch, takže revert obrázků je manuální.

## UI — Historie zápisů

Nahrazuje zrušené `/approvals`. Detail v [../web/client-dashboard.md](../web/client-dashboard.md).

- **`/dashboard/:shopId/write-history`** — list `write_log` (nástroj, status, provedeno, vráceno) s odkazem na detail.
- **`/dashboard/:shopId/write-history/:id`** — detail: args, diff before → after, result/error a tlačítko **Vrátit** (jen u `applied`; volá stejné mapování jako `revert_write`).

Owner-only — loader `dashboard.$shopId.tsx` kontroluje `shop.adminEmail === user.email` (case-insensitive).

## Security shrnutí

- **`confirm: "yes"`** literal guard proti náhodnému zápisu.
- **Trial nemá write tooly** v `tools/list` (anti-freeride, gate v `puls-mcp.ts`).
- **Tool description** explicitně začíná `WRITE — …` a popisuje, že zápis je okamžitý a logovaný (revertovatelný kde to jde). AI klienti to vidí v `tools/list`.
- **Audit:** každý zápis (i selhaný) je v `write_log` s before/after — kompletní stopa „kdo, co, kdy, z čeho na co".
- **Revert** jako záchranná brzda místo schvalování předem — uživatel vidí provedenou změnu v Historii zápisů a může ji jedním kliknutím vrátit.
