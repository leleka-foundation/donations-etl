/**
 * Custom Bolt receiver for Bun.serve().
 *
 * Instead of using Bolt's built-in HTTP server, we handle Slack requests
 * through Bun.serve() and forward them to Bolt's request handler.
 * This allows a single HTTP server to handle both REST API and Slack routes.
 */
import type { Receiver, ReceiverEvent } from '@slack/bolt'
import { z } from 'zod'

/**
 * Zod schema for parsing Slack JSON bodies.
 * Slack bodies are always objects with string keys.
 */
const SlackBodySchema = z.record(z.string(), z.unknown())

/**
 * A minimal Bolt receiver that processes requests forwarded from Bun.serve().
 *
 * Bolt's App expects a Receiver that:
 * 1. Has init() / start() / stop() lifecycle methods
 * 2. Emits events when Slack sends requests
 *
 * This receiver doesn't listen on its own port — instead, the main router
 * calls handleSlackRequest() to forward relevant requests.
 */
export class BunReceiver implements Receiver {
  private bolt:
    | { processEvent: (event: ReceiverEvent) => Promise<void> }
    | undefined

  /**
   * Called by Bolt during App initialization.
   * Stores reference to the event processor.
   */
  init(bolt: { processEvent: (event: ReceiverEvent) => Promise<void> }) {
    this.bolt = bolt
  }

  /**
   * Bolt calls this to "start" the receiver.
   * We don't need to start a server since Bun.serve() handles that.
   */
  async start(): Promise<void> {
    // No-op: Bun.serve() handles HTTP
  }

  /**
   * Bolt calls this to "stop" the receiver.
   */
  async stop(): Promise<void> {
    // No-op
  }

  /**
   * Forward a Slack request to Bolt's event processor.
   *
   * Called by the main router for /slack/* paths.
   * Returns the response body and status to send back.
   */
  async handleSlackRequest(
    body: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    if (!this.bolt) {
      return { status: 500, body: 'Bolt not initialized' }
    }

    let responseBody = ''
    let responseStatus = 200

    const ack: ReceiverEvent['ack'] = async (response) => {
      if (typeof response === 'string') {
        responseBody = response
      } else if (response) {
        responseBody = JSON.stringify(response)
      }
    }

    const event: ReceiverEvent = {
      body: parseSlackBody(body, headers['content-type'] ?? ''),
      ack,
    }

    try {
      await this.bolt.processEvent(event)
    } catch {
      responseStatus = 500
      responseBody = 'Internal Server Error'
    }

    return { status: responseStatus, body: responseBody }
  }
}

/**
 * Parse the Slack request body based on content type.
 *
 * Slack sends form-urlencoded data for slash commands and
 * JSON for interactive components.
 */
function parseSlackBody(
  body: string,
  contentType: string,
): Record<string, unknown> {
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(body)
    const result: Record<string, unknown> = {}
    for (const [key, value] of params.entries()) {
      // Slack sends a JSON payload for interactive messages
      if (key === 'payload') {
        return SlackBodySchema.parse(JSON.parse(value))
      }
      result[key] = value
    }
    return result
  }

  return SlackBodySchema.parse(JSON.parse(body))
}
