# donations-etl-compliance

Compliance toolkit skills for the [donations-etl](https://github.com/vgeshel/donations-etl) project. Install via the donations-etl marketplace.

## What this plugin contains

- **Skills:** `compliance-onboard`, `compliance-status`, `compliance-discover`.
- **MCP server registration:** declares the remote `donations-etl` MCP server in `.mcp.json` (HTTP transport), which exposes the compliance tools and resources used by these skills.

The deployed MCP server provides:

- **Tools** — `compliance-status`, `compliance-onboard`, `compliance-onboard-update`, `compliance-discover-start` / `-status` / `-result`, `compliance-record-evidence`.
- **Resources** — `compliance://status`, `compliance://sources/registry`, `compliance://onboarding/interview-questions`, and per-source `compliance://sources/{sourceId}/manual-evidence-instructions`.
- **Prompt** — `compliance-overview`.

See [`docs/compliance-mcp/PLAN.md`](../../docs/compliance-mcp/PLAN.md) for the full MCP surface design.

## Configuring the MCP server URL

`.mcp.json` ships with a placeholder URL (`https://your-mcp-server.example.com/mcp`). Edit it to point at your deployed Cloud Run instance after the donations-etl MCP server is provisioned.

## See also

- Marketplace: [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json)
- Companion plugin (core ETL skills): [`donations-etl-core`](../donations-etl-core/README.md)
