# Low-stock alert

> Surface e-shop products at or below a stock threshold and recommend which to reorder first.

## Type
workflow

## MCP endpoint
https://pulsmcp.com/mcp

## Required MCP tools
- `products_list`
- `insights_low_stock`
- `insights_top_products`

## Inputs
- `threshold` (integer, optional — defaults to 5)
- `topN` (integer, optional — number of items to highlight, defaults to 20)

## Execution

The agent runs `insights_low_stock` against the configured threshold, cross-references velocity from `insights_top_products`, and produces a prioritized reorder list. OAuth 2.1 with PKCE — see <https://pulsmcp.com/.well-known/oauth-protected-resource>.
