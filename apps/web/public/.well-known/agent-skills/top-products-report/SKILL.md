# Top products report

> Generate a top-selling products report for a date range, broken down by units and revenue.

## Type
workflow

## MCP endpoint
https://pulsmcp.com/mcp

## Required MCP tools
- `insights_top_products`
- `products_get`

## Inputs
- `from` (ISO date, required)
- `to` (ISO date, required)
- `topN` (integer, optional — defaults to 20)

## Execution

The agent calls `insights_top_products` for the range, optionally enriches each entry with `products_get` for full metadata, and renders a report ordered by revenue with a units sub-rank. OAuth 2.1 with PKCE — see <https://pulsmcp.com/.well-known/oauth-protected-resource>.
