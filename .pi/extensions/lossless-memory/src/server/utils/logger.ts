/* eslint-disable no-console */
import type { Logger, LoggerOptions } from 'pino'
import pino from 'pino'
import { resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { getAppConfig } from '../config'
import { isCloudflare } from '../utils/env'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const _loggers: Map<string, Logger> = new Map()

export interface LogFnFields {
  [key: string]: unknown
}

interface SimpleLogger {
  trace: (obj: LogFnFields, msg: string) => void
  debug: (obj: LogFnFields, msg: string) => void
  info: (obj: LogFnFields, msg: string) => void
  warn: (obj: LogFnFields, msg: string) => void
  error: (obj: LogFnFields, msg: string) => void
  fatal: (obj: LogFnFields, msg: string) => void
  child: (bindings: Record<string, unknown>) => SimpleLogger
}

function createConsoleLogger(module: string, level: LogLevel = 'info'): SimpleLogger {
  const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
  const minLevel = levels.indexOf(level)

  const log = (lvl: LogLevel, obj: LogFnFields, msg: string) => {
    if (levels.indexOf(lvl) >= minLevel) {
      const timestamp = new Date().toISOString()
      const prefix = `[${timestamp}] ${lvl.toUpperCase()}: [${module}]`
      const formatted = `${prefix} ${msg} ${JSON.stringify(obj)}`

      switch (lvl) {
        case 'error':
        case 'fatal':
          console.error(formatted)
          break
        case 'warn':
          console.warn(formatted)
          break
        default:
          console.log(formatted)
      }
    }
  }

  return {
    trace: (obj, msg) => log('trace', obj, msg),
    debug: (obj, msg) => log('debug', obj, msg),
    info: (obj, msg) => log('info', obj, msg),
    warn: (obj, msg) => log('warn', obj, msg),
    error: (obj, msg) => log('error', obj, msg),
    fatal: (obj, msg) => log('fatal', obj, msg),
    child: () => createConsoleLogger(module, level),
  }
}

function createNodeLogger(module: string, level?: LogLevel): Logger {
  const config = getAppConfig()
  const logLevel = level || (config.nodeEnv === 'production' ? 'info' : 'debug')
  const isDev = config.nodeEnv === 'development'
  const isTest = config.nodeEnv === 'test'

  if (isTest) {
    const options: LoggerOptions = {
      level: logLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string) => ({ level: label }),
        bindings: () => ({}),
      },
    }
    return pino(options).child({ module })
  }

  const logDir = resolve(process.cwd(), 'logs')
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }
  const logPath = resolve(logDir, `${module}.log`)

  const streamEntries: pino.StreamEntry[] = []

  if (isDev) {
    streamEntries.push({
      level: logLevel,
      stream: pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          messageFormat: `[${module}] {msg}`,
        },
      }),
    })
  }

  streamEntries.push({
    level: logLevel,
    stream: pino.transport({
      target: 'pino/file',
      options: { destination: logPath },
    }),
  })

  return pino({ level: logLevel }, pino.multistream(streamEntries)).child({ module })
}

export function createModuleLoggerSync(module: string, level?: LogLevel): Logger | SimpleLogger {
  if (isCloudflare) {
    return createConsoleLogger(module, level || 'info')
  }

  if (_loggers.has(module)) {
    return _loggers.get(module)!
  }

  const logger = createNodeLogger(module, level)
  _loggers.set(module, logger)
  return logger
}

export const logger = {
  app: () => createModuleLoggerSync('app'),
  db: () => createModuleLoggerSync('db'),
  api: () => createModuleLoggerSync('api'),
  ws: () => createModuleLoggerSync('ws'),
  bootstrap: () => createModuleLoggerSync('bootstrap'),
  module: (name: string) => createModuleLoggerSync(name),
}

export type { Logger }
