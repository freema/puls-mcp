# Daily shop pulse

> One-shot operational briefing — yesterday's revenue, order count, top sellers and any low-stock items.

## Type
workflow

## MCP endpoint
https://pulsmcp.com/mcp

## Required MCP tools
- `insights_sales_summary`
- `insights_top_products`
- `insights_low_stock`

## Inputs
- `date` (ISO date, optional — defaults to yesterday)

## Execution

The agent calls all three insight tools in parallel for the target date and renders a single concise paragraph plus three short tables (revenue, top products, low-stock). OAuth 2.1 with PKCE — see <https://pulsmcp.com/.well-known/oauth-protected-resource>.
