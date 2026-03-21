import { Command } from 'commander'
import { getClient } from '../../utils/api'
import { getLogger } from '../../utils/logger'

export function registerNotificationCommands(program: Command) {
  const notification = program
    .command('notification')
    .description('Notification management commands')

  notification
    .command('list')
    .description('List all notifications')
    .option('--unread-only', 'Show only unread notifications')
    .option('--limit <number>', 'Limit number of results', '20')
    .action(async (options: { unreadOnly?: boolean; limit?: string }) => {
      const logger = getLogger()
      const client = getClient()
      const unreadOnly = Boolean(options.unreadOnly)
      const limit = parseInt(options.limit || '20')

      const res = await client.api.notifications.$get({
        query: { unreadOnly: String(unreadOnly), limit: String(limit) },
      })
      const data = await res.json()
      logger.info(JSON.stringify(data, null, 2))
    })

  notification
    .command('create')
    .description('Create a new notification')
    .requiredOption('-t, --title <title>', 'Notification title')
    .requiredOption('-m, --message <message>', 'Notification message')
    .option('--type <type>', 'Notification type (info|warning|success|error)', 'info')
    .action(async (options: { title: string; message: string; type: string }) => {
      const logger = getLogger()
      const client = getClient()

      const res = await client.api.notifications.$post({
        json: {
          type: options.type as 'info' | 'warning' | 'success' | 'error',
          title: options.title,
          message: options.message,
        },
      })
      const data = await res.json()
      logger.success('Notification created')
      logger.info(JSON.stringify(data, null, 2))
    })

  notification
    .command('unread-count')
    .description('Get unread notification count')
    .action(async () => {
      const logger = getLogger()
      const client = getClient()
      const res = await client.api.notifications['unread-count'].$get()
      const data = await res.json()
      logger.info(JSON.stringify(data, null, 2))
    })

  notification
    .command('mark-read')
    .description('Mark a notification as read')
    .argument('<id>', 'Notification ID')
    .action(async (id: string) => {
      const logger = getLogger()
      const client = getClient()
      const res = await client.api.notifications[':id'].read.$patch({ param: { id } })
      const data = await res.json()
      logger.success('Notification marked as read')
      logger.info(JSON.stringify(data, null, 2))
    })

  notification
    .command('delete')
    .description('Delete a notification')
    .argument('<id>', 'Notification ID')
    .action(async (id: string) => {
      const logger = getLogger()
      const client = getClient()
      const res = await client.api.notifications[':id'].$delete({ param: { id } })
      const data = await res.json()
      logger.success('Notification deleted')
      logger.info(JSON.stringify(data, null, 2))
    })
}
