type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug'

interface LoggerOptions {
  verbose?: boolean
  debug?: boolean
}

class Logger {
  private level: LogLevel = 'info'

  constructor(options: LoggerOptions = {}) {
    if (options.debug || process.env.BIOMIMIC_DEBUG === 'true') {
      this.level = 'debug'
    } else if (options.verbose || process.env.BIOMIMIC_VERBOSE === 'true') {
      this.level = 'info'
    }
  }

  setLevel(level: LogLevel) {
    this.level = level
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug']
    return levels.indexOf(level) <= levels.indexOf(this.level)
  }

  info(message: string, ...args: unknown[]) {
    if (this.shouldLog('info')) {
      process.stdout.write(`${message}${args.length ? ' ' + args.join(' ') : ''}\n`)
    }
  }

  debug(message: string, ...args: unknown[]) {
    if (this.shouldLog('debug')) {
      process.stdout.write(`[debug] ${message}${args.length ? ' ' + args.join(' ') : ''}\n`)
    }
  }

  warn(message: string) {
    if (this.shouldLog('warn')) {
      process.stderr.write(`[warn] ${message}\n`)
    }
  }

  error(message: string) {
    if (this.shouldLog('error')) {
      process.stderr.write(`[error] ${message}\n`)
    }
  }

  success(message: string, ...args: unknown[]) {
    if (this.shouldLog('info')) {
      process.stdout.write(`✓ ${message}${args.length ? ' ' + args.join(' ') : ''}\n`)
    }
  }

  fail(message: string) {
    if (this.shouldLog('error')) {
      process.stderr.write(`✗ ${message}\n`)
    }
  }
}

let logger: Logger | null = null

export function createLogger(options: LoggerOptions = {}): Logger {
  logger = new Logger(options)
  return logger
}

export function getLogger(): Logger {
  if (!logger) {
    logger = new Logger()
  }
  return logger
}

export { Logger, type LogLevel, type LoggerOptions }
