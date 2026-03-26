# donations-etl

A configurable open-source ETL tool for nonprofit donation management. Extracts donation data from multiple payment platforms and fundraising tools, loads it into Google BigQuery for analysis, and generates donor confirmation letters.

**Built with AI** -- This codebase was primarily written by [Claude Code](https://claude.com/claude-code) (Anthropic) and [Codex](https://openai.com/index/codex/) (OpenAI), with human oversight and direction. AI-assisted development enabled rapid iteration on connectors, type-safe pipelines, and comprehensive test coverage.

## Features

- **Multi-source ETL pipeline** -- Extract donations from seven different platforms, normalize them into a unified schema, and load into BigQuery
- **Donor confirmation letters** -- Generate HTML and PDF letters for donors with configurable templates
- **Slack integration** -- Trigger donor letter generation via a `/donor-letter` Slack command
- **Scheduled execution** -- Deploys to GCP Cloud Run as a scheduled job for automatic daily runs
- **Type-safe throughout** -- Zod for runtime validation of all external data, neverthrow for explicit error handling, TypeScript strict mode with no `any` types

## Supported Data Sources

| Source        | Type            | Description                            |
| ------------- | --------------- | -------------------------------------- |
| Mercury       | Bank API        | Operating bank account transactions    |
| PayPal        | Payment API     | Online donation payments               |
| Wise          | Transfer API    | International multi-currency transfers |
| Givebutter    | Fundraising API | Fundraising campaign donations         |
| Venmo         | P2P payments    | Peer-to-peer donation payments (CSV)   |
| Funraise      | Fundraising API | Fundraising platform donations         |
| Google Sheets | Spreadsheet     | Manual check deposit records           |

## Architecture

The project is organized as a monorepo with Bun workspaces:

```
donations-etl/
  packages/
    types/          # Shared TypeScript types and Zod schemas
    connectors/     # Data source connectors (Mercury, PayPal, Wise, etc.)
    bq/             # Google BigQuery loading and query utilities
    letter/         # Donor confirmation letter generation (HTML/PDF)
  apps/
    runner/         # Main ETL pipeline runner (Cloud Run job)
    letter-service/ # Slack bot for donor letter generation
```

## Quick Start

The fastest way to get started is using the interactive setup skill. Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview), then run:

```bash
claude
```

Inside the Claude Code session, run the `/setup` skill. It will walk you through environment configuration and infrastructure provisioning.

## Manual Setup

### Prerequisites

- [Bun](https://bun.sh/) (v1.3 or later)
- A Google Cloud project with BigQuery enabled
- API credentials for the data sources you want to use

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/donations-etl.git
cd donations-etl

# Install dependencies
bun install
```

### Configuration

1. Copy the example environment file:

```bash
cp .env.example .env.local
```

2. Fill in the required values in `.env.local`. See `.env.example` for documentation on each variable. At minimum you will need:
   - Google Cloud credentials and BigQuery dataset configuration
   - API keys or credentials for each data source you want to enable

3. Provision infrastructure (BigQuery tables, Cloud Run service):

```bash
bun run scripts/provision.ts
```

## Key Commands

```bash
# Development
bun test              # Run tests in watch mode
bun test:run          # Run tests once
bun test:coverage     # Run tests with coverage report
bun lint              # Run ESLint
bun typecheck         # Run TypeScript type checking
bun format            # Format code with Prettier

# Build and Run
bun build             # Build for production
bun etl:run           # Run the ETL pipeline locally
bun deploy            # Deploy to GCP Cloud Run
```

## Technology Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Language**: TypeScript (strict mode)
- **Validation**: [Zod](https://zod.dev/) for runtime validation of all external data
- **Error handling**: [neverthrow](https://github.com/supermacro/neverthrow) for explicit Result types
- **Testing**: [Vitest](https://vitest.dev/) with 100% coverage target
- **Data warehouse**: Google BigQuery
- **Deployment**: GCP Cloud Run (scheduled job)
- **Slack integration**: Bolt for JavaScript

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
