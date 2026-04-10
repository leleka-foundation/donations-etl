/**
 * MCP tool: query-donations
 *
 * Answers natural language questions about donations by translating
 * them to BigQuery SQL via an AI agent.
 */
import {
  BigQueryClient,
  buildQueryFn,
  runDonationAgent,
  type AgentError,
} from '@donations-etl/bq'
import type { ResultAsync } from 'neverthrow'
import type { Logger } from 'pino'
import type { Config } from '../config'

/**
 * Dependencies injected into the tool handler for testability.
 */
export interface QueryDonationsDeps {
  config: Config
  logger: Logger
}

/**
 * Handle a query-donations tool call.
 *
 * Creates a BigQuery client, builds a safe query function, and runs
 * the donation agent to answer the user's question.
 */
export function handleQueryDonations(
  args: { question: string },
  deps: QueryDonationsDeps,
): ResultAsync<{ text: string; sql: string | null }, AgentError> {
  const { config, logger } = deps

  logger.info({ question: args.question }, 'query-donations tool called')

  const bqClient = new BigQueryClient(
    {
      projectId: config.PROJECT_ID,
      datasetRaw: '',
      datasetCanon: config.DATASET_CANON,
    },
    { bucket: '' },
  )

  const queryFn = buildQueryFn(bqClient.executeReadOnlyQuery.bind(bqClient))

  return runDonationAgent(
    args.question,
    {
      projectId: config.PROJECT_ID,
      datasetRaw: '',
      datasetCanon: config.DATASET_CANON,
    },
    queryFn,
    undefined,
    {
      model: config.AGENT_MODEL,
      orgName: config.ORG_NAME,
      apiKey: config.GOOGLE_GENERATIVE_AI_API_KEY,
    },
  )
}
