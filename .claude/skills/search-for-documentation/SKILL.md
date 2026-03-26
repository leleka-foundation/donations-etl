---
name: search-for-documentation
description: Use when working with external libraries, APIs, GitHub Actions, or SDKs. Reminds to search for current documentation instead of relying on training data which may be outdated.
---

# Always Search for Current Documentation

Your training data is outdated. APIs change frequently. Libraries release new versions.

## When to Search

Before using any of these, search the web for current documentation:

- Library APIs or function signatures
- Package versions and compatibility
- GitHub Actions versions
- Framework-specific patterns
- SDK methods and options

## How to Search

1. Check `package.json` for the installed version
2. Use WebSearch to find official docs for that specific version
3. If training data conflicts with web docs, trust the web docs

## Documentation Sources

- Zod: https://zod.dev/llms.txt
- Claude Agent SDK: https://platform.claude.com/docs/en/agent-sdk/typescript.md
- GitHub Actions: Search `https://github.com/{owner}/{repo}/releases` for versions

## Examples of Training Data Problems

- API parameter names changed between versions
- New required options were added
- Deprecated features still appear in training data
- Version incompatibilities cause silent failures
