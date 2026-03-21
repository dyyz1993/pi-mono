/**
 * 统一应用错误类型系统
 *
 * 错误分类：
 * - ValidationError: 输入验证错误 (400)
 * - AuthenticationError: 认证错误 (401)
 * - AuthorizationError: 权限错误 (403)
 * - NotFoundError: 资源不存在 (404)
 * - ConflictError: 资源冲突 (409)
 * - BusinessError: 业务逻辑错误 (422)
 * - RateLimitError: 限流错误 (429)
 * - SystemError: 系统内部错误 (500)
 */

export enum ErrorCode {
  // 验证错误 (400)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  INVALID_FORMAT = 'INVALID_FORMAT',
  MISSING_FIELD = 'MISSING_FIELD',

  // 认证错误 (401)
  UNAUTHORIZED = 'UNAUTHORIZED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  TOKEN_MISSING = 'TOKEN_MISSING',

  // 权限错误 (403)
  FORBIDDEN = 'FORBIDDEN',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INSUFFICIENT_ROLE = 'INSUFFICIENT_ROLE',

  // 资源不存在 (404)
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  DISPUTE_NOT_FOUND = 'DISPUTE_NOT_FOUND',

  // 资源冲突 (409)
  CONFLICT = 'CONFLICT',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
  ALREADY_EXISTS = 'ALREADY_EXISTS',

  // 业务逻辑错误 (422)
  BUSINESS_ERROR = 'BUSINESS_ERROR',
  INVALID_STATE = 'INVALID_STATE',
  OPERATION_NOT_ALLOWED = 'OPERATION_NOT_ALLOWED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',

  // 限流错误 (429)
  RATE_LIMIT = 'RATE_LIMIT',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',

  // 系统错误 (500)
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export interface ErrorDetail {
  field?: string
  message: string
  code?: string
}

export interface AppErrorOptions {
  code: ErrorCode
  message: string
  statusCode: number
  details?: ErrorDetail[]
  cause?: Error
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly details?: ErrorDetail[]
  readonly cause?: Error
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error'
  readonly timestamp: string

  constructor(options: AppErrorOptions) {
    super(options.message)
    this.name = 'AppError'
    this.code = options.code
    this.statusCode = options.statusCode
    this.details = options.details
    this.cause = options.cause
    this.logLevel = options.logLevel ?? 'warn'
    this.timestamp = new Date().toISOString()

    // 保持堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  toJSON() {
    return {
      success: false,
      error: this.message,
      code: this.code,
      status: this.statusCode,
      details: this.details,
      timestamp: this.timestamp,
    }
  }

  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError
  }
}

// ==================== 具体错误类 ====================

/**
 * 验证错误 (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super({
      code: ErrorCode.VALIDATION_ERROR,
      message,
      statusCode: 400,
      details,
      logLevel: 'info',
    })
    this.name = 'ValidationError'
  }
}

/**
 * 认证错误 (401)
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Unauthorized', code: ErrorCode = ErrorCode.UNAUTHORIZED) {
    super({
      code,
      message,
      statusCode: 401,
      logLevel: 'warn',
    })
    this.name = 'AuthenticationError'
  }

  static tokenExpired(): AuthenticationError {
    return new AuthenticationError('Token has expired', ErrorCode.TOKEN_EXPIRED)
  }

  static tokenInvalid(): AuthenticationError {
    return new AuthenticationError('Invalid token', ErrorCode.TOKEN_INVALID)
  }

  static tokenMissing(): AuthenticationError {
    return new AuthenticationError('Authentication token is required', ErrorCode.TOKEN_MISSING)
  }
}

/**
 * 权限错误 (403)
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Forbidden', details?: ErrorDetail[]) {
    super({
      code: ErrorCode.FORBIDDEN,
      message,
      statusCode: 403,
      details,
      logLevel: 'warn',
    })
    this.name = 'AuthorizationError'
  }

  static permissionDenied(permission?: string): AuthorizationError {
    return new AuthorizationError(
      permission ? `Permission denied: ${permission}` : 'Permission denied',
      permission ? [{ message: `Missing required permission: ${permission}` }] : undefined
    )
  }

  static insufficientRole(currentRole?: string, requiredRole?: string): AuthorizationError {
    return new AuthorizationError(
      'Insufficient role privileges',
      currentRole && requiredRole
        ? [
            {
              message: `Role '${currentRole}' does not meet required role '${requiredRole}'`,
            },
          ]
        : undefined
    )
  }
}

/**
 * 资源不存在错误 (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super({
      code: ErrorCode.NOT_FOUND,
      message: identifier ? `${resource} not found: ${identifier}` : `${resource} not found`,
      statusCode: 404,
      logLevel: 'info',
    })
    this.name = 'NotFoundError'
  }

  static user(id?: string): NotFoundError {
    return new NotFoundError('User', id)
  }

  static order(id?: string): NotFoundError {
    return new NotFoundError('Order', id)
  }

  static dispute(id?: string): NotFoundError {
    return new NotFoundError('Dispute', id)
  }

  static ticket(id?: string): NotFoundError {
    return new NotFoundError('Ticket', id)
  }
}

/**
 * 资源冲突错误 (409)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super({
      code: ErrorCode.CONFLICT,
      message,
      statusCode: 409,
      details,
      logLevel: 'info',
    })
    this.name = 'ConflictError'
  }

  static duplicateEntry(field: string, value: string): ConflictError {
    return new ConflictError(`Duplicate entry for ${field}`, [
      { field, message: `Value '${value}' already exists` },
    ])
  }
}

/**
 * 业务逻辑错误 (422)
 */
export class BusinessError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.BUSINESS_ERROR,
    details?: ErrorDetail[]
  ) {
    super({
      code,
      message,
      statusCode: 422,
      details,
      logLevel: 'info',
    })
    this.name = 'BusinessError'
  }

  static invalidState(currentState: string, expectedStates: string[]): BusinessError {
    return new BusinessError(`Invalid state transition`, ErrorCode.INVALID_STATE, [
      {
        message: `Current state '${currentState}' is not valid. Expected one of: ${expectedStates.join(', ')}`,
      },
    ])
  }

  static operationNotAllowed(reason: string): BusinessError {
    return new BusinessError(`Operation not allowed: ${reason}`, ErrorCode.OPERATION_NOT_ALLOWED)
  }
}

/**
 * 限流错误 (429)
 */
export class RateLimitError extends AppError {
  constructor(
    message = 'Too many requests',
    public readonly retryAfter?: number
  ) {
    super({
      code: ErrorCode.RATE_LIMIT,
      message,
      statusCode: 429,
      logLevel: 'warn',
    })
    this.name = 'RateLimitError'
  }
}

/**
 * 系统错误 (500)
 */
export class SystemError extends AppError {
  constructor(message = 'Internal server error', cause?: Error) {
    super({
      code: ErrorCode.SYSTEM_ERROR,
      message,
      statusCode: 500,
      cause,
      logLevel: 'error',
    })
    this.name = 'SystemError'
  }

  static databaseError(cause?: Error): SystemError {
    return new SystemError('Database operation failed', cause)
  }

  static serviceUnavailable(service: string): SystemError {
    return new SystemError(`Service '${service}' is unavailable`)
  }
}

// ==================== 错误转换工具 ====================

/**
 * 将未知错误转换为 AppError
 */
export function toAppError(error: unknown): AppError {
  if (AppError.isAppError(error)) {
    return error
  }

  if (error instanceof Error) {
    return new SystemError(error.message, error)
  }

  return new SystemError(String(error))
}

/**
 * 安全地执行异步操作，将错误转换为 AppError
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
  errorMapper?: (error: unknown) => AppError
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw errorMapper ? errorMapper(error) : toAppError(error)
  }
}
