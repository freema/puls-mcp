# Technický brief — Upgates konektor pro MCP server

> Puls je **MCP pro každý e-shop**; architektura je platformově neutrální (`PlatformConnector`). Puls má dvě integrace: **Shoptet** (`packages/shoptet-client`, dokumentace v [`docs/shoptet/`](docs/shoptet/)) a **Upgates**. Tento brief popisuje **Upgates konektor** (`packages/upgates-client`) a slouží jako single-source-of-truth pro jeho integraci. Konsolidace z discovery proti reálnému Upgates API; další platformy se přidávají přes registry konektorů.

---

## 1. Cesta k API

| | **Upgates REST API v2** |
|---|---|
| Auth header | `Authorization: Basic base64(apiUser:apiKey)` — statický, žádný token-exchange |
| Schvalování | Doplněk v Upgates marketplace (verified addon), aktivace per eshop |
| Distribuce | Marketplace pro všechny eshopy s povoleným API |
| Setup čas | Aktivace doplňku v adminu eshopu (vydá API přístup) |
| Endpoint | `https://<shop>.admin.upgates.com/api/v2/...` (per-eshop hostname z aktivace) |
| API přístup | **30 dní** (dev/test okno — review musí proběhnout uvnitř) |

**Naše volba:** Verified addon přes Upgates marketplace. Credentials (apiUser + apiKey) přebíráme z aktivačního payloadu, base URL je per-eshop `apiUrl`.

---

## 2. Lifecycle doplňku

| # | Fáze | Kdo řídí | Poznámka |
|---|---|---|---|
| 1 | Registrace doplňku v Upgates partner portálu | My | nastavení callback URL + signature |
| 2 | Aktivace eshopem (marketplace) | Eshopař | Upgates pošle aktivační callback s `signature_v2` |
| 3 | Provoz | My | per-shop credentials, webhooky, MCP endpoint |
| 4 | Deaktivace / uninstall | Eshopař | invaliduje API přístup → graceful degrade |

**Klíčové:** API přístup, který Upgates vydá pro dev/test, má **30denní platnost** — produkční review koordinuj na datum uvnitř okna.

---

## 3. Aktivace (install handshake)

### Co Upgates pošle našemu serveru
Aktivační callback (POST) s identitou eshopu, API credentials (`apiUser`, `apiKey`, `apiUrl`) a podpisem `signature_v2`.

### Naše povinnosti
- **Ověřit `signature_v2`** veřejným klíčem Upgates (RSA), viz níže
- Uložit per-shop credentials (apiKey **šifrovaný** v DB, `enc:v1:…`)
- Z `apiUrl` odvodit `shops.domain` (per-eshop hostname; mock fallback `${token}.upgates`)
- Doplnit `adminEmail` z `/owner` lookupu (nebo párování dokončí uživatel přihlášením v iframu)

### Signature verification (aktivace)
- Algoritmus: **RSA podpis `signature_v2`**
- Veřejný klíč: fetch `https://files.upgates.com/addons/signature/api.signature.pub.key`, cache v paměti procesu
- E2E/test override: env `UPGATES_SIGNATURE_PUBKEY` (PEM nebo base64 PEM)
- Implementace: `packages/upgates-client/src/{signature,signature-key}.ts`

### Po aktivaci máme
- `apiUser` + `apiKey` (Basic auth, **persistentní** dokud eshopař nezruší)
- per-eshop `apiUrl` (base pro všechna volání)
- Žádný OAuth token-exchange — auth je statický Basic header

---

## 4. Auth & credentials

| Položka | Zdroj | Účel |
|---|---|---|
| **apiUser** | aktivační payload → `shops.platform_api_login` | uživatelská část Basic auth |
| **apiKey** | aktivační payload → `shops.platform_api_key` (šifrovaně) | klíč Basic auth |
| **apiUrl** | aktivační payload → `shops.api_base_url` | per-eshop endpoint |

- Header: `Authorization: Basic base64(apiUser:apiKey)` — statický, **žádný refresh / žádné expiry tokeny**
- apiKey se v DB drží šifrovaně (`decryptSecret` jen v paměti při sestavení klienta)
- Base URL normalizujeme: reálná `apiUrl` končí na `/api/v2`, request cesty klienta prefix `/api/v2/...` už obsahují → koncový `/api/v2` ořezáváme (kvůli Prism mocku bez prefixu)

---

## 5. Settings UI (iframe v Upgates adminu)

### Technické požadavky
- **HTTPS povinné**
- **`X-Frame-Options` header MUSÍ chybět** (jinak iframe block); CSP `frame-ancestors` povolí Upgates admin doménu
- Auth admin uživatele přes aktivační token / iframe párování (XSRF: `state` parametr)

### Design guidelines
- Service name + logo, krátký popis, setup section, tooltipy
- Konzistentní s vizuálem Upgates adminu

### Zakázáno
- Promovat jiné služby
- Sbírat unnecessary eshop data
- Linkovat externí offerings (mimo náš service)

---

## 6. Webhooks

### Vlastnosti
- Volitelné (registrujeme jen kategorie, které potřebujeme): `orders`, `products`, `customers`, `categories`
- Registrace přes `POST /api/v2/webhooks`; GET pre-check kvůli idempotenci (reinstall neduplikuje)
- POST request od Upgates na náš callback URL
- **HTTP 200** rychle; process **asynchronně** (handler nesmí blokovat)
- Deduplikace na naší straně (možnost duplicitních zpráv)

### Payload (datový webhook)
Datový webhook nese **seznam ID** dotčených entit + jméno eshopu, ne plná data — follow-up fetch dělá sync worker.
```json
{
  "eshop": "<eshop-identifier>",
  "orders": ["123", "124"]
}
```
Idempotency klíč si volí volající (Upgates nemá `eventInstance`), např. `hash(event + ids.join(','))`.

### Signature verification (datový webhook)
- Header: **`X-Upgates-Webhook-Secret`**
- Mechanismus: per-shop **secret** vygenerovaný a uložený při registraci webhooku, porovnaný v **konstantním čase** (`timingSafeEqual`) — NE HMAC
- Validace: odmítnout při neshodě
- Pozn.: hlavní webhook dokumentace Upgates podpis neuvádí (na rozdíl od aktivačních callbacků se `signature_v2`); bezpečný default = per-shop secret. `[O]` ověřit reálný mechanismus.

---

## 7. Uninstall / deaktivace flow

### Co Upgates udělá
1. **Invaliduje API přístup** → další API calls selhou
2. Volitelně: callback / webhook o deaktivaci

### Co musíme udělat
- Deaktivovat eshop v naší DB → nepokračovat ve volání API
- **Připravit se na možný reinstall** (uživatel může změnit názor)

### GDPR — náš closed loop
- Smazat persisted data klienta (logs, cache, settings)
- Anonymizovat / retenci audit logu (`write_log`) dle privacy policy
- Definovat retention policy v naší privacy policy

---

## 8. Rate Limits

### Connection limit
- **Max 3 souběžné** requesty (sdílený concurrency gate v klientu)

### Pool limity (per eshop)
Upgates vrací v každé response `*-Remaining` hlavičky pro hodinový / denní / celkový pool:
- `X-Rate-Limit-Hour-Remaining`
- `X-Rate-Limit-Day-Remaining`
- `X-Rate-Limit-Total-Remaining`

### Status kódy
- **`429 Too Many Requests`** — rate limit hit → respektovat `Retry-After` (cap 60s, delší re-queueovat sync)

### Náš HTTP klient (`packages/upgates-client/src/http.ts`)
1. **Proaktivní backoff:** když některý `*-Remaining` pool klesne pod práh (`RATE_LIMIT_LOW_THRESHOLD = 5`), další request se přibrzdí (`RATE_LIMIT_BACKOFF_MS = 30s`), ať on-demand MCP requesty neutlučou poslední tokeny poolu
2. Při 429 jeden retry s respektem k `Retry-After` (cap 60s)
3. Sdílený concurrency gate (max 3)

### Stránkování
- Wrapper nese `number_of_pages` / `current_page` → `paginateAll` iteruje (strop `MAX_PAGES = 1000`)
- `limit` umožní early-exit (na velkém eshopu netáhne celou historii → šetří pool budget)

---

## 9. Anti-patterns (čeho se vyvarovat)

❌ Polling místo webhooks
❌ Žádná cache pro stabilní data (kategorie, produkty)
❌ Ignorování `*-Remaining` hlaviček → vyčerpání poolu
❌ Okamžitý retry po 429
❌ Žádné error handling

✅ Delta / inkrementální sync přes webhook ID seznamy
✅ Cache s rozumným TTL pro static data
✅ Webhooks pro event-driven updates
✅ Proaktivní backoff podle pool hlaviček

---

## 10. Architektura MCP serveru — implikace

### Komponenty které potřebujeme
1. **Aktivační endpoint** (`/api/upgates/install`) — ověří `signature_v2`, uloží per-shop credentials
2. **Settings endpoint** (iframe-friendly) — generuje user-specific MCP endpoint URL
3. **Webhook endpoint** (`/api/webhooks/upgates`) — ověří secret, enqueue sync ID seznamů
4. **MCP endpoint** (`/mcp`) — shop a tool kategorie z OAuth tokenu (consent UI)
5. **Sync worker** — follow-up fetch entit z webhook ID seznamů
6. **Rate-limit aware HTTP client** — pool monitoring, proaktivní backoff

### Co NEPOTŘEBUJEME
- ❌ HTML/JS injekce do template eshopu — MCP je pure backend
- ❌ Vlastní platební gateway integraci
- ❌ Frontend assets na eshopu

### Závislosti
- HTTPS endpoints (Let's Encrypt)
- Postgres pro credentials + per-shop config (apiKey šifrovaný)
- Background job runner pro webhook sync
- Rate-limit middleware (concurrency gate + pool backoff)

---

## 11. Reference

| Stránka | URL |
|---|---|
| Upgates API docs | https://upgatesapiv2.docs.apiary.io/ |
| Veřejný klíč (signature) | https://files.upgates.com/addons/signature/api.signature.pub.key |
| Partner / addons portál | https://www.upgates.cz/ |

---

## 12. Otevřené otázky (TBD)

1. **Webhook signature mechanismus** `[O]` — potvrdit, zda datový webhook používá per-shop secret nebo jiný podpis
2. **Přesné názvy pagination wrapperu** `[O]` — `number_of_pages` vs. `numberOfPages` (čteme defenzivně)
3. **Write capability coverage** — které zápisové operace jsou ověřené proti reálnému API (flipují se per-capability po live ověření)
4. **Reálné `*-Remaining` reset okno** — kdy se pool obnovuje (volíme konzervativní fixní backoff)
