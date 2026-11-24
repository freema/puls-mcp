# puls-mcp ⚰️

> **☠️ Archived project — shut down on 2026-07-23.** This repository is read-only. It is not developed, maintained or supported, and the hosted service no longer exists.
>
> 🇨🇿 [Česká verze níže](#česky)

**Puls — MCP for every e-shop** connected AI assistants (Claude, ChatGPT, Cursor) to online stores through the [Model Context Protocol](https://modelcontextprotocol.io). The architecture is platform-neutral (a `PlatformConnector` registry) and ships with two integrations: **Shoptet** (OAuth add-on: install handshake, HMAC-signed webhooks) and **Upgates** (verified add-on: `signature_v2` activation, Basic-auth API). Both are served by the same MCP server and the same tool names; each shop's platform picks its connector.

The code is published as a **reference implementation** of a multi-tenant MCP server for e-commerce. It is not a product you can install and run as-is.

## What's inside

| Path | What it is |
|---|---|
| `apps/mcp-server` | Express MCP server (Streamable HTTP): read and write tools for orders, products, categories, customers and coupons, per-shop memory, audit log and revert of writes |
| `apps/web` | React Router v7 app: OAuth 2.1 authorization server (discovery, Dynamic Client Registration, PKCE, token binding to a shop), OTP and Google login, the shop owner's dashboard, the admin panel, and the platform install / activation / webhook endpoints (Shoptet `/api/install` + `/api/webhooks`, Upgates `/api/upgates/*` + `/api/webhooks/upgates`) |
| `packages/platform-core` | Platform-neutral connector interface, capabilities and registry |
| `packages/shoptet-client` | Shoptet API client: OAuth install + short-lived API token cache, reads, writes, HMAC-SHA1 webhook verification |
| `packages/upgates-client` | Upgates REST API client, `signature_v2` verification, write helpers |
| `packages/ecommerce-common` | Shared e-commerce types and utilities |
| `packages/db` | Drizzle ORM schema (PostgreSQL) |
| `tests-e2e` | Playwright end-to-end tests (OAuth flow, install/webhooks and MCP tools for both platforms, admin) |
| `spec/` | OpenAPI specs of Shoptet and Upgates used by the Prism mocks (`mock-shoptet`, `mock-upgates`) |
| `docs/` | Architecture, OAuth, MCP tools, Shoptet integration, operations and testing docs (mostly in Czech) |

The public marketing site (homepage, pricing, blog, prompt gallery, legal pages) was removed before publishing. Only the parts the MCP product needs to work remain.

## Interesting bits

- **OAuth 2.1 for MCP:** a generic `/mcp` endpoint where the access token is bound to one shop and to the set of tools the user allowed. See [`docs/oauth/`](./docs/oauth/).
- **Write model:** writes run immediately, then go into an audit log, and every write can be reverted. See [`docs/mcp/write-tools-and-audit.md`](./docs/mcp/write-tools-and-audit.md).
- **Two platforms, one tool surface:** tool names are neutral (`list_orders`, `update_product`, …); each connector declares capabilities, so a tool a platform can't do is simply not registered. See [`docs/shoptet/`](./docs/shoptet/) for the Shoptet side.
- **Consent categories:** the user chooses which groups of tools an AI client may use. See [`docs/mcp/consent-categories.md`](./docs/mcp/consent-categories.md).
- **OTP abuse protection** for e-mail login. See [`docs/operations/otp-abuse-protection.md`](./docs/operations/otp-abuse-protection.md).

## Running it locally

Everything runs in Docker through [Task](https://taskfile.dev):

```bash
cp .env.example .env
task dev        # postgres + redis + Shoptet/Upgates mocks + web + mcp-server
task db:reset   # migrations + seed (admin user, demo shops, OAuth client)
task inspector  # MCP Inspector against the local server
task check      # lint + typecheck + unit tests
task e2e        # Playwright E2E (inside containers)
```

Locally both platforms run against Prism mocks (`mock-shoptet`, `mock-upgates`). To call real shop APIs you need your own Shoptet OAuth add-on credentials (`SHOPTET_*`) or Upgates API credentials. No credentials or production data are included.

## Status

Final state is **v0.8.0**. Production (`pulsmcp.com`) was shut down, the server was wiped, and the domains now redirect to the author's site. Issues and pull requests are not accepted.

## License

[WTFPL](./LICENSE) — do what the f*ck you want. No warranty, no support, it is dead anyway.

## Contact

Tomáš Grasl · https://www.tomasgrasl.cz/

---

## Česky

> **☠️ Mrtvý projekt, vypnutý 23. 7. 2026.** Repo je archivované (jen pro čtení). Dál se nevyvíjí ani nepodporuje a služba už neběží.

**Puls — MCP pro každý e-shop** propojoval AI asistenty (Claude, ChatGPT, Cursor) s e-shopy přes Model Context Protocol. Architektura je platformově neutrální (registry `PlatformConnector`) a obsahuje dvě integrace: **Shoptet** (OAuth doplněk — install handshake, webhooky podepsané HMAC) a **Upgates** (ověřený doplněk — aktivace se `signature_v2`, Basic-auth API). Obě obsluhuje stejný MCP server se stejnými názvy nástrojů; konektor se vybírá podle platformy e-shopu.

**Proč konec:** projekt nedával dost smysl na to, aby se vyplatilo ho dál provozovat a podporovat. Chyběla trakce i kapacita.

**Co tu zůstává:** kód monorepa (MCP server s OAuth 2.1, Shoptet a Upgates konektory, dashboard a admin, Drizzle schéma, Playwright E2E) a dokumentace v [`docs/`](./docs/README.md) jako referenční implementace MCP serveru pro e-commerce. Marketingový web (homepage, ceník, blog, galerie promptů, právní stránky) byl před zveřejněním odstraněn.

**Licence:** [WTFPL](./LICENSE) — dělej si s tím, co chceš.

**Kontakt:** Tomáš Grasl · https://www.tomasgrasl.cz/
