import type { Command } from 'commander'
import { registerTodoCommands } from './todo'
import { registerNotificationCommands } from './notification'
import { registerConfigCommands } from './config'

export function registerModules(program: Command) {
  registerTodoCommands(program)
  registerNotificationCommands(program)
  registerConfigCommands(program)
}

export { registerTodoCommands, registerNotificationCommands, registerConfigCommands }
