#!/usr/bin/env bun
/**
 * MCP server for donations ETL.
 *
 * Exposes donation querying and letter generation as MCP tools
 * over Streamable HTTP transport, authenticated via Google OIDC.
 */
import { closeBrowser, launchBrowser } from '@donations-etl/letter'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { createAuthVerifier } from './auth'
import { loadConfig } from './config'
import { createLogger } from './logger'
import { buildDonationsPrompt } from './tools/donations-prompt'
import { handleGenerateLetter } from './tools/generate-letter'
import { handleQueryBigQuery } from './tools/query-bigquery'

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig()
  } catch (error) {
    console.error(
      'Configuration Error:',
      error instanceof Error ? error.message : error,
    )
    process.exit(1)
  }

  const logger = createLogger(config)

  // Launch browser for PDF generation (non-fatal — server works without it,
  // but generate-letter with format=pdf will fail)
  const browserResult = await launchBrowser()
  if (browserResult.isErr()) {
    logger.warn(
      { error: browserResult.error },
      'Browser not available — PDF letter generation will be disabled',
    )
  } else {
    logger.info('Browser launched for PDF generation')
  }

  // Auth is required unless MCP_ALLOW_ANONYMOUS=true
  if (!config.GOOGLE_CLIENT_ID || !config.MCP_ALLOWED_DOMAIN) {
    if (!config.MCP_ALLOW_ANONYMOUS) {
      logger.error(
        'GOOGLE_CLIENT_ID and MCP_ALLOWED_DOMAIN are required. ' +
          'Set MCP_ALLOW_ANONYMOUS=true for local dev without auth.',
      )
      process.exit(1)
    }
    logger.warn('Auth disabled — MCP_ALLOW_ANONYMOUS is set')
  }

  const verifyAuth =
    config.GOOGLE_CLIENT_ID && config.MCP_ALLOWED_DOMAIN
      ? createAuthVerifier(
          config.GOOGLE_CLIENT_ID,
          config.MCP_ALLOWED_DOMAIN,
          logger,
        )
      : null

  // Track transports per session for stateful connections
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>()

  /**
   * Create and configure a new MCP server instance.
   */
  function createMcpServerInstance(): McpServer {
    const mcp = new McpServer(
      { name: 'donations-etl', version: '1.0.0' },
      {
        capabilities: { tools: {}, prompts: {} },
      },
    )

    // Prompt: schema and SQL rules for the host LLM
    mcp.registerPrompt(
      'donations-schema',
      {
        title: 'Donations Schema',
        description:
          'BigQuery table schema and SQL rules for querying donation data. Use this context when writing SQL for the query-bigquery tool.',
      },
      () => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: buildDonationsPrompt(config),
            },
          },
        ],
      }),
    )

    // Tool: execute read-only SQL against BigQuery
    mcp.registerTool(
      'query-bigquery',
      {
        title: 'Query BigQuery',
        description:
          'Execute a read-only BigQuery SQL query against the donations table. Write SQL using the schema from the donations-schema prompt. Returns result rows or an error.',
        inputSchema: {
          sql: z.string().describe('BigQuery SQL SELECT query to execute'),
        },
      },
      async ({ sql }) => {
        const result = await handleQueryBigQuery({ sql }, { config, logger })

        if (result.isErr()) {
          return {
            content: [{ type: 'text', text: `Error: ${result.error.message}` }],
            isError: true,
          }
        }

        const { rows, totalRows } = result.value
        const text =
          rows.length === 0
            ? 'Query returned no results.'
            : `${totalRows} row(s) returned${totalRows > 50 ? ' (showing first 50)' : ''}:\n\n${JSON.stringify(rows, null, 2)}`

        return { content: [{ type: 'text', text }] }
      },
    )

    mcp.registerTool(
      'generate-letter',
      {
        title: 'Generate Donor Letter',
        description:
          'Generate a donor confirmation letter (PDF or HTML) for one or more email addresses. Returns the letter content.',
        inputSchema: {
          emails: z
            .array(z.string().email())
            .min(1)
            .describe('Donor email addresses'),
          from: z
            .string()
            .optional()
            .describe('Start date filter (ISO format, e.g. 2025-01-01)'),
          to: z
            .string()
            .optional()
            .describe('End date filter (ISO format, e.g. 2025-12-31)'),
          format: z
            .enum(['pdf', 'html'])
            .optional()
            .describe('Output format (default: pdf)'),
          signerName: z.string().optional().describe('Letter signer name'),
          signerTitle: z.string().optional().describe('Letter signer title'),
        },
      },
      async ({ emails, from, to, format, signerName, signerTitle }) => {
        const result = await handleGenerateLetter(
          { emails, from, to, format, signerName, signerTitle },
          { config, logger },
        )

        if (result.isErr()) {
          return {
            content: [{ type: 'text', text: `Error: ${result.error.message}` }],
            isError: true,
          }
        }

        const { value } = result

        if (value.format === 'html') {
          return {
            content: [
              {
                type: 'text',
                text: `Generated HTML letter for ${value.donorName}`,
              },
              {
                type: 'resource',
                resource: {
                  uri: `data:text/html;base64,${Buffer.from(value.content).toString('base64')}`,
                  mimeType: 'text/html',
                  text: value.content,
                },
              },
            ],
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: `Generated PDF letter for ${value.donorName}`,
            },
            {
              type: 'resource',
              resource: {
                uri: `data:application/pdf;base64,${value.content}`,
                mimeType: 'application/pdf',
                blob: value.content,
              },
            },
          ],
        }
      },
    )

    return mcp
  }

  const server = Bun.serve({
    port: config.PORT,
    async fetch(request) {
      const url = new URL(request.url)

      // Health check — no auth required
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // CORS preflight
      if (request.method === 'OPTIONS' && url.pathname === '/mcp') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers':
              'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
          },
        })
      }

      // MCP endpoint
      if (url.pathname === '/mcp') {
        // Authenticate (if enabled)
        let authInfo: AuthInfo | undefined

        if (verifyAuth) {
          const authResult = await verifyAuth(request)
          if (!authResult.ok) {
            return new Response(
              JSON.stringify({ error: authResult.error.message }),
              {
                status: authResult.error.status,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }
          logger.debug(
            { email: authResult.user.email },
            'Authenticated MCP request',
          )
          authInfo = authResult.authInfo
        }

        const sessionId = request.headers.get('mcp-session-id')

        const existingTransport = sessionId
          ? transports.get(sessionId)
          : undefined
        if (existingTransport) {
          // Existing session — reuse transport
          const transport = existingTransport
          const response = await transport.handleRequest(request, {
            authInfo,
          })
          return addCorsHeaders(response)
        }

        // New session — create transport and MCP server
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport)
            logger.info({ sessionId: id }, 'MCP session started')
          },
          onsessionclosed: (id) => {
            transports.delete(id)
            logger.info({ sessionId: id }, 'MCP session closed')
          },
        })

        const mcp = createMcpServerInstance()
        await mcp.connect(transport)

        const response = await transport.handleRequest(request, {
          authInfo,
        })
        return addCorsHeaders(response)
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  logger.info({ port: server.port }, 'MCP server started')

  const shutdown = async () => {
    logger.info('Shutting down...')
    await server.stop()
    for (const [, transport] of transports) {
      await transport.close()
    }
    transports.clear()
    await closeBrowser()
    process.exit(0)
  }

  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.on('SIGINT', () => {
    void shutdown()
  })
}

/**
 * Add CORS headers to a response from the transport.
 */
function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
