# Customer lookup

> Find an e-shop customer by email, phone or name and return their full purchase history.

## Type
tool

## MCP endpoint
https://pulsmcp.com/mcp

## Required MCP tools
- `customers_search`
- `customers_get`
- `orders_list`
- `insights_top_customers`

## Inputs
- `query` (string, required — email, phone or name fragment)

## Execution

The agent runs `customers_search`, picks the best match (or asks the user to disambiguate), then calls `customers_get` plus `orders_list` filtered by `customerId` to assemble a 360° profile including total spend and recency. OAuth 2.1 with PKCE — see <https://pulsmcp.com/.well-known/oauth-protected-resource>.
