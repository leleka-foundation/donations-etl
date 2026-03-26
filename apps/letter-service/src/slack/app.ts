/**
 * Slack Bolt App initialization and command/view registration.
 */
import { App } from '@slack/bolt'
import type { Logger } from 'pino'
import type { Config } from '../config'
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

  return { app, receiver }
}
