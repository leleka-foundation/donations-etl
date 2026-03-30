# donations-etl

## What this does

A US non-profit may accept donation via a large number of methods: checks, ACH, PayPal, fundraising platforms such as Givebutter, Zeffy, etc., emplyee matching platforms, and so on. Collecting all donation records in a single place (for reporting, CRM, and other workflows) is annoying. I have not found reliable SaaS ETL solutions that supported all, or even most, of the methods my non-profit uses. Hence this project.

This is a configurable and extensible open-source ETL tool for nonprofit donation management. Extracts donation data from multiple payment platforms and fundraising tools, and loads it into Google BigQuery. There is also a utility to generate donor confirmation letters from Slack, which is a common use case for us.

It's unlikely that this will be useful to you out of the box. The way to use it it to start `claude`, `codex`, or the AI dev tool of your choice, and ask the tool to build it, configure it for your needs, and deploy it.

**Built with AI** -- This codebase was primarily written by [Claude Code](https://claude.com/claude-code) and [Codex](https://openai.com/index/codex/).

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

Out of the box, we use Google BigQuery as the destination for data and we deploy to GCP. You can adjust these for yourself.

## Quick Start

Fork the repo and clone your fork.

The fastest way to get started is using the interactive setup skill. Run Claude Code, Codex, or any other AI coding assistant that support skills. If it doesn't use the standard AGENTS.md file and .agents/skills directory, you may need to create some symlinks or copy some files.

Inside the assistant session, run the `setup` skill. It will install dependencies, walk you through environment configuration, and provision infrastructure if necessary. Or use the assistant to customize your data sources, destination, deployment, etc. Take a look at skills available in `.agents/skills`, and add your own.

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
