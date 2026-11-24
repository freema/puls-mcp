# Sales period comparison

> Compare revenue, orders and AOV between two date ranges (e.g. this week vs. last week).

## Type
workflow

## MCP endpoint
https://pulsmcp.com/mcp

## Required MCP tools
- `insights_sales_summary`
- `insights_top_products`

## Inputs
- `current` ({ from: ISO date, to: ISO date }, required)
- `baseline` ({ from: ISO date, to: ISO date }, required)

## Execution

The agent calls `insights_sales_summary` for both windows, computes deltas (absolute and %), and optionally diffs the top products list to highlight movers. OAuth 2.1 with PKCE — see <https://pulsmcp.com/.well-known/oauth-protected-resource>.
