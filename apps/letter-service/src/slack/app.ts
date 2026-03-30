/**
 * Slack Bolt App initialization and command/view registration.
 */
import { BigQueryClient, generateSql } from '@donations-etl/bq'
import { App } from '@slack/bolt'
import type { Logger } from 'pino'
import type { Config } from '../config'
import { handleDonationQuery } from './commands/donation-query'
import { handleDonorLetterCommand } from './commands/donor-letter'
import { BunReceiver } from './receiver'
import type { ViewSubmissionArgs } from './views/letter-modal'
import {
  handleLetterModalSubmission,
  LETTER_MODAL_CALLBACK_ID,
} from './views/letter-modal'

/**
 * Create and configure the Slack Bolt App with a custom Bun receiver.
 *
 * Returns both the App and the receiver so the router can forward requests.
 */
export function createSlackApp(config: Config, logger: Logger) {
  const receiver = new BunReceiver()

  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    signingSecret: config.SLACK_SIGNING_SECRET,
    receiver,
  })

  // Register slash command
  app.command('/donor-letter', async (args) => {
    await handleDonorLetterCommand(args, config, logger)
  })

  // Register modal submission handler.
  // We bridge between Bolt's discriminated union types and our handler's simpler interface.
  app.view(LETTER_MODAL_CALLBACK_ID, async ({ ack, view, client }) => {
    const handlerArgs: ViewSubmissionArgs = {
      ack: async (response?: {
        response_action: string
        errors?: Record<string, string>
      }) => {
        if (response?.errors) {
          await ack({
            response_action: 'errors',
            errors: response.errors,
          })
        } else {
          await ack()
        }
      },
      view,
      client: {
        files: {
          uploadV2: (opts: Parameters<typeof client.files.uploadV2>[0]) =>
            client.files.uploadV2(opts),
        },
        chat: {
          postMessage: (opts: { channel: string; text: string }) =>
            client.chat.postMessage(opts),
        },
        conversations: {
          open: (opts: { users: string }) => client.conversations.open(opts),
        },
      },
    }

    await handleLetterModalSubmission(handlerArgs, config, logger)
  })

  // Register app_mention handler for donation queries
  {
    const bqClient = new BigQueryClient(
      {
        projectId: config.PROJECT_ID,
        datasetRaw: 'donations_raw',
        datasetCanon: config.DATASET_CANON,
      },
      { bucket: '' }, // Not used for queries
    )

    app.event('app_mention', async ({ event, client }) => {
      // Strip the bot mention to get the question
      const question = event.text.replace(/<@[A-Z0-9]+>/g, '').trim()

      if (!question) {
        await client.chat.postMessage({
          channel: event.channel,
          text: 'Ask me a question about donations! For example: "How much did we raise this year?"',
          thread_ts: event.thread_ts ?? event.ts,
        })
        return
      }

      await handleDonationQuery(
        question,
        event.channel,
        event.thread_ts,
        event.ts,
        config,
        logger,
        {
          generateSqlFn: generateSql,
          bqClient,
          slackClient: client,
        },
      )
    })

    logger.info('Donation query bot enabled')
  }

  return { app, receiver }
}
