# Per-shop memory

Puls drží **per-shop "memory"** — pre-rendered systém kontext + granulární items, které AI klient automaticky vidí v každé tool description, takže si dovede pamatovat preference uživatele a learned facts napříč MCP sessions.

Code: [`apps/mcp-server/src/memory/`](../../apps/mcp-server/src/memory/), DB schema `shop_memory` + `shop_memory_items`.

## Použití flow

1. Uživatel v dashboardu **zapne memory** (toggle, dnes implementováno přes `shops.memory_enabled`). Tím se vytvoří/povolí `shop_memory` row.
2. Při OAuth consent uživatel zaškrtne kategorii `memory` → token dostane `memory` permission.
3. AI klient zavolá `initialize` → factory:
   - `getOrLoadShopMemory(db, shop.id)` — načte z `shop_memory` (pre-rendered `system_context`, `tool_contexts`, `prompt_version`).
   - `withMemoryEnhancedDescriptions(server, memory)` — wrapne `server.tool` tak, že každá tool description dostane appendnutý relevant memory blok.
4. AI klient v `tools/list` vidí enhanced descriptions, používá tooly s tou znalostí.
5. AI klient může memory editovat přes `memory_set` / `memory_forget` (write tools v memory kategorii).

## DB schema

### `shop_memory` (1:1 ke shops)
| Sloupec | Účel |
|---|---|
| `system_context` | Pre-renderovaný blok zobrazený v každé tool description (max ~500 chars). |
| `tool_contexts` | JSONB `{ [toolName]: string }` — per-tool kontext bloky. |
| `prompt_version` | Bumped při každé items mutaci → driver in-memory cache invalidace. |

### `shop_memory_items`
| Sloupec | Účel |
|---|---|
| `category` | `preference | context | learned | instruction` (enum) |
| `source` | `user | ai_learned` (enum) — odkud přišlo |
| `label` | Krátký titul ("default report period") |
| `content` | Vlastní fakt/preferenci (1-2 věty, max 1000 chars) |
| `applies_to_tools` | JSONB array tool names — null = global |
| `priority` | int -10..10, vyšší = renderuje se první |
| `usage_count` | Inkrementováno při každém využití (TODO) |
| `is_active` | Soft delete |

## Renderer / enhancer

[`apps/mcp-server/src/memory/enhancer.ts`](../../apps/mcp-server/src/memory/enhancer.ts) — `enhanceToolDescription(toolName, originalDescription, memory)`:
1. Vezme `memory.systemContext` (vždy)
2. Vezme `memory.toolContexts[toolName]` (pokud exist)
3. Appendne na konec original description ve formátu `\n\n[Shop context: ...]`

Výsledek: AI klient v `tools/list` vidí původní description + memory dovětek v jednom stringu.

### Cache invalidace

`getOrLoadShopMemory` cachuje per-shop v in-memory mapě, klíčem `(shopId, promptVersion)`. Když uživatel/AI memory edituje (přes `memory_set` nebo dashboard UI), worker:
1. Insertne / updatne `shop_memory_items` row.
2. Bumpne `shop_memory.prompt_version`.
3. Re-renderuje `system_context` a `tool_contexts` z aktuálních items.

Při dalším MCP `initialize` se `getOrLoadShopMemory` zeptá DB → cache miss (jiný `prompt_version`) → reload.

## MCP tooly

Detail v [tools-reference.md#memory-tools](tools-reference.md#memory-tools).

| Tool | Operace |
|---|---|
| `memory_get` | List všeho — vrátí `enabled`, `systemContext`, `items[]` |
| `memory_set` | Save preferenci/fakt; LLM volá když user explicitně řekne preferenci |
| `memory_forget` | Delete by id, nebo `all: true` |

### Pravidla pro AI klienta (v tool descriptions)

- Volej `memory_get` **jednou na začátku session**, aby ses připravil bez znovu-ptaní.
- Volej `memory_set` když uživatel **explicitně řekne preferenci** ("always show me last 7 days"), **potvrdí non-obvious fakt** ("our XML feed is on Heureka, not Zboží"), nebo **dá instrukci pro recurring decision**.
- **NE volej** pro: transient session state, sensitive data (passwords, full PII), guesses.

## Limit per tier

`pricing_tiers.max_memory_items`:
- `trial` — 50 items
- `starter` — 200
- `pro` — 1000
- `business` — `-1` (unlimited)

(Hodnoty viz `/admin/pricing`. Limit checkne `addMemoryItem` před insertem.)

## Privacy & GDPR

- Memory data **zůstávají v EU** (Postgres v Coolify EU region).
- Při `delete account` (`/nastaveni/delete-account`) se memory zachová protože je per-shop, ne per-user. Při `uninstall` shopu se cascade smaže (FK `shop_memory.shopId → shops.id ON DELETE CASCADE`).
- Vystaveno přes `memory_get` — uživatel vidí **přesně co je uložené**, žádné hidden fields.
- `memory_forget all` mažeme okamžitě bez retence.
