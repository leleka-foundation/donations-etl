# donations-etl-core

Core skills for the [donations-etl](https://github.com/vgeshel/donations-etl) toolkit. Install via the donations-etl marketplace.

## What this plugin contains

- **Skills:** `donor-letter`, `donations-query`, `running-etl-locally`, `deploying-etl`, `bootstrap`, `create-connector`, `provision`, `agentic-analytics`, `slack-bot`, `mcp-server`.
- **MCP server registration:** declares the remote `donations-etl` MCP server in `.mcp.json` (HTTP transport).

## Configuring the MCP server URL

`.mcp.json` ships with a placeholder URL (`https://your-mcp-server.example.com/mcp`). Edit it to point at your deployed Cloud Run instance after the donations-etl MCP server is provisioned. The skills work standalone if you don't deploy the server, but the conversational query and letter-generation flows expect it.

## Compliance

For the federal/California compliance toolkit (entity onboarding, status, discovery), install the companion plugin **donations-etl-compliance** from the same marketplace.

## See also

- Marketplace: [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json)
- Project README: [`/README.md`](../../README.md)
- Plan: [`docs/compliance-mcp/PLAN.md`](../../docs/compliance-mcp/PLAN.md)
