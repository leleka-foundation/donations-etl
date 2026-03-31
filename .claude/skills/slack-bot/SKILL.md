---
name: slack-bot
description: Build Slack bots with Bolt for JavaScript on Bun. Use this skill whenever the user wants to add a Slack command, event handler, assistant, modal, interactive component, or any Slack integration. Also triggers on "add a slash command", "Slack notification", "Slack bot", "app_mention", "Assistant API", or "Slack event". Covers both the Assistant API (DM side-panel) and channel @mention patterns.
---

# Building Slack Bots with Bolt

This skill guides you through building Slack bot features using the Bolt framework on Bun.

## When to Use This

- Adding slash commands (`/command`)
- Handling @mentions in channels
- Building AI assistants with Slack's Assistant API (DM side-panel)
- Creating modals and interactive components
- Sending messages, reactions, file uploads
- Setting up Event Subscriptions

## Architecture Overview

The bot runs on Bun with a custom receiver that replaces Bolt's built-in HTTP server:

```
Bun.serve() → routes requests:
  /slack/commands      → Bolt receiver → command handlers
  /slack/interactivity → Bolt receiver → modal/action handlers
  /slack/events        → Bolt receiver → event handlers (app_mention, assistant)
  /api/*               → REST handlers
  /health              → health check
```

See `apps/service/src/main.ts` for the server setup and `apps/service/src/slack/receiver.ts`
for the custom BunReceiver.

## Key Pattern: Async Ack

Slack requires a 200 response within 3 seconds. For handlers that do slow work (AI, database),
the BunReceiver returns the HTTP response as soon as `ack()` is called, while the handler
continues in the background. See `receiver.ts` for the `Promise.race()` pattern.

Always drop Slack retries at the entry point:

```typescript
if (request.headers.get('x-slack-retry-num')) {
  return new Response('', { status: 200 })
}
```

## Dual-Channel Pattern: Assistant API + @Mentions

For bots that answer questions, support both interaction models:

1. **Assistant API** — DM conversations in Slack's AI side-panel. Provides suggested prompts,
   native "thinking" status, and thread titles. Requires `assistant:write`, `im:history` scopes.

2. **@Mention in channels** — Shared visibility so colleagues can see the dialog. Uses
   `app_mention` event. Requires `app_mentions:read`, `channels:history` scopes.

Both share the same backend logic. See `apps/service/src/slack/app.ts` for the reference
implementation showing both patterns side by side.

## Conversation History in Threads

For follow-up questions, fetch thread history and pass as multi-turn context:

```typescript
const thread = await client.conversations.replies({
  channel,
  ts: threadTs,
  limit: 20,
})
// Filter: skip current message, skip bot infrastructure messages
// Map: bot_id present → assistant role, otherwise → user role
```

Filter out infrastructure messages (like SQL thread replies) that would confuse the LLM.
The thread is the conversation store — no server-side state needed.

## Slack App Configuration

Required scopes depend on features used:

| Feature        | Scopes                          |
| -------------- | ------------------------------- |
| Slash commands | `commands`                      |
| Post messages  | `chat:write`                    |
| DMs            | `im:write`, `im:history`        |
| File uploads   | `files:write`                   |
| @mentions      | `app_mentions:read`             |
| Thread history | `channels:history`              |
| Assistant API  | `assistant:write`, `im:history` |
| Reactions      | `reactions:write`               |

Event Subscriptions (set Request URL to `https://<service>/slack/events`):

- `app_mention` — for channel @mentions
- `assistant_thread_started`, `assistant_thread_context_changed`, `message.im` — for Assistant API

## url_verification Challenge

When enabling Event Subscriptions, Slack sends a verification challenge. Handle it before
forwarding to Bolt:

```typescript
if (url.pathname === '/slack/events') {
  const ChallengeSchema = z.object({
    type: z.literal('url_verification'),
    challenge: z.string(),
  })
  // Try parsing; if it matches, respond with the challenge
  // If not, fall through to Bolt
}
```

## File References

| File                                 | Purpose                                     |
| ------------------------------------ | ------------------------------------------- |
| `apps/service/src/slack/app.ts`      | App setup, Assistant + @mention handlers    |
| `apps/service/src/slack/receiver.ts` | Custom BunReceiver with async ack           |
| `apps/service/src/main.ts`           | HTTP server, retry filter, url_verification |
| `apps/service/src/slack/commands/`   | Slash command handlers                      |
| `apps/service/src/slack/views/`      | Modal handlers                              |
| `apps/service/src/slack/formatters/` | Message formatting utilities                |
| `apps/service/src/config.ts`         | Config with Slack env vars                  |

## Common Gotchas

1. **Duplicate messages**: Slack retries if no 200 within 3s. Filter `x-slack-retry-num` header.
2. **Cold start retries**: Cloud Run cold starts delay the first ack. The retry filter is essential.
3. **Assistant API is DM-only**: Cannot be used in channels. Use @mention for shared visibility.
4. **Thread history scopes**: `channels:history` is required to read thread replies in channels.
5. **Bun receiver, not Bolt server**: Bolt's built-in server doesn't run — Bun.serve() handles HTTP.
