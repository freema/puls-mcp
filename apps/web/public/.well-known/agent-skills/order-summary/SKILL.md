# Summarize recent orders

> List, filter and summarize e-shop orders for a given period — totals, status breakdown, and top customers.

## Type
workflow

## MCP endpoint
https://pulsmcp.com/mcp

## Required MCP tools
- `orders_list`
- `orders_get`
- `insights_sales_summary`

## Inputs
- `from` (ISO date, optional — defaults to last 7 days)
- `to` (ISO date, optional — defaults to today)
- `status` (string, optional — e-shop order status code)

## Execution

The agent calls `orders_list` for the date range, optionally narrows by status, and uses `insights_sales_summary` to compute totals and the top-N customers. Authentication uses OAuth 2.1 with PKCE — see <https://pulsmcp.com/.well-known/oauth-protected-resource>.
