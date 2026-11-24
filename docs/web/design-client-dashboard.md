# Design — Client Dashboard (e-shopař)

> **Cíl:** Shoptet e-shopař po instalaci Pulse najde **do 60 sekund** svůj MCP endpoint URL, zkopíruje ho do Claude Desktop a vidí potvrzení že to funguje. Jedna stránka = "Onboarding done".
> **Kdo se přihlašuje:** majitel/admin Shoptet e-shopu. Přihlášení primárně přes **Shoptet OAuth iframe** (settings page v admin panelu Shoptetu), sekundárně přes **standalone web** s magic link na admin email.

---

## 2 vstupní body, 1 stejné UI

### A) Iframe v Shoptet adminu (`/settings/$shopId`)
- Shoptet otevře v iframe URL `https://puls-mcp.cz/settings/<shopId>?eshopId=#SHOP_ID#&lang=#LANGUAGE#`
- ⚠️ **Žádný X-Frame-Options header**, HTTPS, max 60s timeout
- Auth: Puls verifikuje `eshopId` v DB + použije Shoptet OAuth verification flow pro admin user
- UI: stejný dashboard jako standalone, jen bez headeru/footeru a sidebar (kompaktnější)

### B) Standalone web (`/dashboard`)
- Pro klienty kteří přijdou přímo na puls-mcp.cz (např. z marketing emailu)
- Auth: magic link na shop admin email (nebo Shoptet OAuth re-auth)
- Po loginu redirect na `/dashboard/<shopId>` (pokud má jen 1 shop) nebo `/dashboard/select` (více shopů — agentura)

---

## Sekce dashboardu (single-page-ish, ne moc routes)

### 0. Top bar (jen v standalone, v iframu skryté)
- Logo Pulse
- Název shopu (z DB) + status badge (ACTIVE / PAUSED / UNINSTALLED)
- Theme toggle
- Profil dropdown: nastavení účtu, odhlášení

### 1. Hero card — "Vaše MCP URL"
**Hlavní akce dashboardu**, pixel-prominent:

```
┌─────────────────────────────────────────────────────────────┐
│  ✅ Puls je nainstalovaný                                    │
│                                                              │
│  Vaše MCP endpoint:                                          │
│  ┌──────────────────────────────────────────────┐ [Copy]   │
│  │  https://puls-mcp.cz/mcp/abc123?key=xyz789   │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  [Návod pro Claude Desktop]  [Návod pro ChatGPT]  [Cursor]  │
│                                                              │
│  Test connection: ⏳ Zkouším... → ✅ Funguje (latency 142ms) │
└─────────────────────────────────────────────────────────────┘
```

- "Test connection" tlačítko volá náš MCP endpoint a vrací OK/error
- Tooltip: "Tento URL je tajný. Nesdílejte ho. Pokud unikne → [Regenerovat]"

### 2. Quick stats (4 mini cards)
- **Aktivních AI klientů:** 2 (Claude Desktop, Cursor) — kolik různých `client_id` se za 7 dní připojilo
- **MCP volání (7 dní):** 142
- **Top tool:** `shoptet_list_orders` (87×)
- **Quota využita:** 14% (z 1 000/den u Pro tieru) — progress bar

### 3. Recent activity (sloupec, ~10 řádků)
| Čas | Tool | Status | Detail |
|---|---|---|---|
| 2m ago | shoptet_list_orders | ✅ | `?status=new&limit=10` |
| 14m ago | shoptet_get_product | ✅ | guid `abc-...` |
| 1h ago | shoptet_list_orders | ⚠️ rate-limited (429) | retried OK |

Klik na řádek → modal s plným request/response (sanitized).

### 4. Setup wizard (jen pokud user ještě nepřipojil žádného AI klienta)
Strip s 3 kroky, checkmarks postupně se odškrtávají automaticky podle telemetrie:
1. ☐ Zkopírovat MCP URL → klik na Copy v hero
2. ☐ Vložit do Claude Desktop config → návod (modal s screenshoty)
3. ☐ Zkusit první prompt → "Napiš v Claude: 'Kolik objednávek mám tento týden?' a stiskni Enter"

Po dokončení 3. kroku zmizí.

### 5. Tools (collapsible — defaultně sbalené)
Seznam dostupných MCP tools s on/off toggle (v Sprint 5+ konfigurovatelné per shop):
- ✅ shoptet_list_orders
- ✅ shoptet_get_product
- ✅ shoptet_list_customers
- ⚠️ shoptet_update_product_description (Pro tier required)
- ⚠️ shoptet_apply_pricelist (Pro tier required)
- 🔒 shoptet_create_discount_campaign (Premium tier required)

### 6. Settings
- **Plán:** Free / Pro / Premium — link na upgrade přes Shoptet billing
- **Webhook events:** seznam registrovaných events (read-only ve Sprintu 2-3, konfigurovatelné v 4+)
- **Rate limit přístup:** zobrazení aktuálního bucket fill, tooltip vysvětlení Shoptet limitů
- **MCP URL:** tlačítko "Regenerovat secret" s warning modalem
- **Odinstalovat:** info že odinstalace probíhá v Shoptet adminu

### 7. Help & docs (footer area)
- Link na docs.puls-mcp.cz
- Link na FAQ
- "Kontaktujte podporu" — email button
- Status page: status.puls-mcp.cz

---

## Routes (Remix)

```
apps/web/app/routes/
├── dashboard._index.tsx               # /dashboard — pro multi-shop user redirect na select, single shop redirect na první
├── dashboard.select.tsx               # /dashboard/select — výběr shopu (agentury)
├── dashboard.$shopId._index.tsx       # /dashboard/<shopId> — main dashboard view (sekce 1-5)
├── dashboard.$shopId.activity.tsx     # /dashboard/<shopId>/activity — full activity log
├── dashboard.$shopId.settings.tsx     # /dashboard/<shopId>/settings — sekce 6
├── dashboard.$shopId.regenerate.tsx   # action: regenerate mcpEndpointSecret
├── settings.$shopId.tsx               # /settings/<shopId> — IFRAME version (compact, no top bar)
└── login.tsx                          # /login — magic link (opt.)
```

## Komponenty (`apps/web/app/components/dashboard/`)

| Komponenta | Použití |
|---|---|
| `McpUrlCard.tsx` | sekce 1, hero card s copy + test |
| `QuickStatsGrid.tsx` | sekce 2, 4 mini cards |
| `ActivityTable.tsx` | sekce 3 + 4 (full activity page) |
| `SetupWizard.tsx` | sekce 4, conditional render |
| `ToolsList.tsx` | sekce 5 |
| `SettingsCard.tsx` | sekce 6 |
| `ConnectionTester.tsx` | "Test connection" v sekci 1 |
| `ClientGuideModal.tsx` | modaly s návodem pro Claude / ChatGPT / Cursor |
| `ShopHeader.tsx` | top bar (skrýt v iframu) |

## Layout

```
apps/web/app/routes/dashboard.tsx (parent layout)
└── ShopHeader (skrytý v iframu via ?embed=1 query)
    └── Outlet (children)
        └── Sidebar (skrytý v iframu, nebo collapsed)
            └── Main content area
```

Iframe varianta = `/settings/$shopId.tsx` má **separátní layout** bez headeru/sidebar.

## Data needed (Drizzle queries)

Pro main dashboard view:
- `shops` — shop info (name, status, plan, domain, mcpEndpointSecret)
- `webhook_notifications` — count za 7 dní (přehled aktivit)
- `mcp_call_logs` — nová tabulka v Sprintu 4 (každý MCP call → 1 row pro audit)
  - Pro Sprint 3 fake data nebo Redis counter

## Tech detaily
- **Tailwind 4** + shadcn (Card, Button, Badge, Tooltip, Modal, Tabs, Progress)
- **Tmavý mode** sync s Shoptet adminem (iframe parent přes `postMessage` posílá theme)
- **i18n:** CZ + EN (settings page má `lang` placeholder od Shoptetu)
- **`@shoptet/ui` NPM package** — pro `/settings/$shopId` iframe variantu (design konsistentní s Shoptet adminem)
- **Skeleton loaders** pro každou kartu (data loading)
- **Toast notifikace** (sonner) pro úspěch/chybu akcí
- **Optimistic UI** pro toggle tools, regenerate atd.

## Bezpečnost
- Auth: per-route loader kontroluje že přihlášený user má přístup k `<shopId>` (DB query nebo signed JWT)
- CSRF: form actions s automatic Remix CSRF
- MCP URL secret: nikdy v query stringu při redirektu, jen v iframu po auth
- Audit log: každá akce (regenerate, settings change) zapsaná

## Iframe specifika (`/settings/$shopId`)
- **Žádný X-Frame-Options** v response headers
- **CSP:** `frame-ancestors https://*.myshoptet.com`
- Compact UI: jen sekce 1 (MCP URL hero), 2 (quick stats), 4 (setup wizard pokud nedokončený), 6 (settings link na full dashboard)
- Plný dashboard otevřít v novém okně: button "Otevřít plný přehled →"

## NON-GOALS (Sprint 3)
- ❌ Multi-shop správa (agentury) — Sprint 4
- ❌ Konfigurovatelné MCP tools per shop — Sprint 5
- ❌ Custom rate limits per tool — Sprint 5
- ❌ Detailní billing (faktury, platby) — Shoptet to dělá za nás
- ❌ Plná i18n — Sprint 4
- ❌ Notifikace (email/Slack) — Sprint 5

## Acceptance pro Sprint 3 (kdy je dashboard "hotový")
- [ ] `/dashboard/<shopId>` zobrazí MCP URL s funkčním Copy
- [ ] "Test connection" reálně zkouší MCP endpoint a vrací výsledek
- [ ] Quick stats zobrazí reálná data (nebo zero state pro nový shop)
- [ ] Activity log má alespoň 10 položek (real, ne mock)
- [ ] Setup wizard zmizí po 3. kroku
- [ ] Settings: regenerate secret funguje + warning modal
- [ ] `/settings/<shopId>` lze embedovat v iframe na localhost (test přes simple HTML page)
- [ ] Iframe varianta nemá `X-Frame-Options` header
- [ ] Mobile responzivní (320px+)
- [ ] Lighthouse A11y 95+
