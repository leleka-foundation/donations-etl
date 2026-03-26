# CLAUDE.md

This file provides guidance to Claude Code and other coding agents when working with code in this repository.

## Project Overview

A configurable open-source ETL tool for nonprofit donation management, built with Bun and TypeScript. Extracts donations from multiple payment platforms, transforms and loads them into BigQuery, and generates donor confirmation letters.

See files in [docs/](docs/) for product specs and requirements.

## Quick Reference

### Key Commands

```bash
bun typecheck        # Run TypeScript type checking
bun lint             # Run ESLint
bun test:coverage    # Run tests once
bun format           # Format code with Prettier
bun build            # Build for production
```

### Technology Stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript in strict mode
- **Testing**: Vitest
- **Validation**: Zod for runtime validation
