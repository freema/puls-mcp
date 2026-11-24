# `/settings/:shopId` — iframe v Shoptet adminu

Speciální verze dashboardu, kterou Shoptet embed v admin rozhraní e-shopaře. Slouží jako "addon settings page" — uživatel si v Shoptet adminu otevře Puls a vidí stručný stav, MCP URL, a tlačítko "Otevřít plný přehled" (otevře v novém tabu).

Code: [`apps/web/app/routes/settings.$shopId.tsx`](../../apps/web/app/routes/settings.$shopId.tsx), iframe chrome: [`apps/web/app/components/dashboard/embed-chrome.tsx`](../../apps/web/app/components/dashboard/embed-chrome.tsx)

## Iframe requirementy (Shoptet spec)

- **HTTPS povinné**
- **`X-Frame-Options` MUSÍ chybět** (default helmet/Express posílá `SAMEORIGIN` — musíme override)
- **CSP `frame-ancestors` MUSÍ povolit `https://*.myshoptet.com`**
- Max timeout: 60 sekund (rendering)

## Headers

```ts
export function headers(): HeadersInit {
  return {
    'X-Frame-Options': '',                        // empty string overrides default
    'Content-Security-Policy':
      "frame-ancestors 'self' https://*.myshoptet.com",
  };
}
```

> **Pozn.**: prázdný string v `X-Frame-Options` Express vyhodí header úplně. Helmet default by jinak SAMEORIGIN forced.

## Loader

Stejný owner-check jako `/dashboard/:shopId`:
1. `requireSessionUser` (jinak redirect `/login` — uživatel se musí přihlásit, **session cookie je v iframe pod jiným origin** → SameSite=None v prod).
2. SELECT shop, ověř `adminEmail === user.email`.
3. Load tier + stats.

## URL parametry (Shoptet spec)

Shoptet při render iframe nahradí v URL:
- `#SHOP_ID#` → ID e-shopu (Shoptet's `project.id`)
- `#LANGUAGE#` → `cs` / `sk` / `en` / `hu`

V naší implementaci použijeme `:shopId` (cuid z naší DB), takže Shoptet musí dostat URL ve formátu:
```
https://pulsmcp.com/settings/<our_shop_cuid>?eshopId=#SHOP_ID#&lang=#LANGUAGE#
```

> Mapping `eshopId` (Shoptet) ↔ `shopId` (cuid) řešíme v installu, kdy si `shop_id` posíláme zpátky do Shoptetu při registraci settings page URL. TBD potvrdit s Shoptet partnerstvím.

## Render

```
┌─────────────────────────────────────────────────────────┐
│ [Logo Puls] [● Aktivní]      QUOTA ██░░░ 134/1000  [↗ Otevřít plný přehled] │
│ Embedded v Shoptet adminu · <ShopName>                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ <McpUrlCard>          <QuickStatsGrid>                  │
│ Vaše MCP endpoint URL: ...                              │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ [Blog ↗] [Kontakt] [Podpora] [v1.0.0]                   │
└─────────────────────────────────────────────────────────┘
```

### Header (`<EmbedHeader>`)
- Logo Puls + status badge (`Aktivní` zelený / shop status pill)
- "Embedded v Shoptet adminu · <ShopName>"
- Quota indicator (chip s progress bar)
- **`<a data-testid="open-full-dashboard">`** — link `/dashboard/:shopId` v novém tabu (`target="_blank"`)

### Body
Subset dashboardu:
- `<McpUrlCard>` — MCP URL ke zkopírování do Claude Desktop / Cursor
- `<QuickStatsGrid>` — KPI cards (calls today, errors, ...)

### Footer (`<EmbedFooter>`)
- Blog link
- Kontakt link
- Podpora (mailto: `support@example.com`)
- Verze (right-aligned)

## Cookie strategie

Klíčové: cookie musí fungovat **cross-site** (Shoptet doména je `*.myshoptet.com`, naše doména je `pulsmcp.com`).

[`apps/web/app/lib/auth/session.server.ts:30`](../../apps/web/app/lib/auth/session.server.ts):
```ts
const sameSite = secure ? 'SameSite=None' : 'SameSite=Lax';
```

V production (`NODE_ENV=production` → `secure=true`):
- `SameSite=None; Secure` — povoluje cross-site cookie v iframe.

V dev (HTTP localhost):
- `SameSite=Lax` — `None` by browser ignoroval bez `Secure`. Iframe v dev funguje díky local origin `localhost:13000`.

## Test

[`tests-e2e/tests/iframe-embed.spec.ts`](../../tests-e2e/tests/iframe-embed.spec.ts):
1. Install shop přes API.
2. Seed session cookie pro owner email.
3. Vytvoří iframe v page (přes `evaluate`):
   ```html
   <iframe src="<base>/settings/<shopId>" />
   ```
4. Ověří, že uvnitř iframe je viditelný `data-testid="settings-embed-root"` + `data-testid="open-full-dashboard"`.

## Bezpečnost

- **Owner-only** — bypass nemožný. Loader vyhazuje 403 pokud cookie session nepatří shop ownerovi.
- **CSP frame-ancestors** — iframe povolen jen pod `*.myshoptet.com` + `'self'`. Cizí stránka nemůže náš `/settings/:shopId` embedded.
- **Open redirect prevention** — link "Otevřít plný přehled" jde na **náš** doménu, ne na URL z parametru.
- **No data leakage do parent frame** — iframe nepoužívá `postMessage`, vše přes server-side render.

## Co iframe NEDĚLÁ

- ❌ Nemá sidebar (pouze top bar + body + footer; bere se jako "stripped" dashboard)
- ❌ Nemá Activity log, Tools, Approvals, Connections — to je v plném `/dashboard/:shopId`
- ❌ Nemá user menu / logout — uživatel je in z Shoptet adminu, takhle dělá session per origin

## Co kdyby uživatel nebyl přihlášený

Loader vyhodí `redirect('/login')`. Uvnitř iframe se objeví naše login stránka (e-mail / Google) — uživatel se přihlásí, redirectne ho zpět.

> **Edge case**: pokud Shoptet user je jiný účet než ten, kdo má `adminEmail` v naší DB, dostane 403. UI by mu mělo říct "Tento účet nepatří k tomuto e-shopu, přepněte se" (TBD: lepší error UX).
