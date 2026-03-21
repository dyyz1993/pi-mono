/**
 * 路由响应配置 - 简化版
 *
 * 设计理念：
 * 1. 路由只定义业务成功响应
 * 2. 框架级错误（401, 403, 500）由全局处理器自动添加
 * 3. 业务错误（404, 409, 422）在路由中声明需要哪些
 */

import { z } from '@hono/zod-openapi'
import { ApiSuccessSchema, ApiErrorSchema } from '@shared/schemas'

// ==================== 基础响应 ====================

export function successResponse<T extends z.ZodTypeAny>(schema: T, description: string) {
  return {
    content: {
      'application/json': { schema: ApiSuccessSchema(schema) },
    },
    description,
  }
}

export function errorResponse(description: string) {
  return {
    content: {
      'application/json': { schema: ApiErrorSchema },
    },
    description,
  }
}

// ==================== 业务错误响应（按需使用） ====================

export const NotFoundResponse = errorResponse('Resource not found')
export const ConflictResponse = errorResponse('Resource conflict')
export const BusinessErrorResponse = errorResponse('Business rule violation')
export const ValidationResponse = errorResponse('Invalid input')

// ==================== 简化的路由响应构建器 ====================

/**
 * 路由响应选项
 */
export interface RouteResponseOptions {
  /** 资源不存在 (404) - 用于 get/update/delete */
  notFound?: boolean | string
  /** 资源冲突 (409) - 用于 create/update 有唯一约束时 */
  conflict?: boolean | string
  /** 业务逻辑错误 (422) - 用于复杂业务规则 */
  businessError?: boolean | string
  /** 验证错误 (400) - 用于自定义验证消息 */
  validation?: boolean | string
}

/**
 * 定义路由响应 - 只关注业务
 *
 * @example
 * // 简单的获取路由
 * responses: defineResponses(DisputeSchema, 'Get dispute', {
 *   notFound: true,  // 可能返回 404
 * })
 *
 * // 创建路由
 * responses: defineResponses(DisputeSchema, 'Create dispute', {
 *   conflict: 'Dispute already exists',  // 可能返回 409
 * })
 *
 * // 复杂业务路由
 * responses: defineResponses(DisputeSchema, 'Resolve dispute', {
 *   notFound: true,
 *   businessError: 'Cannot resolve in current state',
 * })
 */
export function defineResponses<T extends z.ZodTypeAny>(
  schema: T,
  description: string,
  options: RouteResponseOptions = {}
): Record<number, ReturnType<typeof successResponse> | ReturnType<typeof errorResponse>> {
  const responses: Record<
    number,
    ReturnType<typeof successResponse> | ReturnType<typeof errorResponse>
  > = {
    200: successResponse(schema, description),
  }

  // 业务错误 - 按需添加
  if (options.notFound) {
    responses[404] = errorResponse(
      typeof options.notFound === 'string' ? options.notFound : 'Resource not found'
    )
  }

  if (options.conflict) {
    responses[409] = errorResponse(
      typeof options.conflict === 'string' ? options.conflict : 'Resource conflict'
    )
  }

  if (options.businessError) {
    responses[422] = errorResponse(
      typeof options.businessError === 'string' ? options.businessError : 'Business rule violation'
    )
  }

  if (options.validation) {
    responses[400] = errorResponse(
      typeof options.validation === 'string' ? options.validation : 'Invalid input'
    )
  }

  return responses
}

/**
 * 定义创建路由响应 - 自动添加 201
 */
export function defineCreateResponses<T extends z.ZodTypeAny>(
  schema: T,
  description: string,
  options: RouteResponseOptions = {}
): Record<number, ReturnType<typeof successResponse> | ReturnType<typeof errorResponse>> {
  const responses: Record<
    number,
    ReturnType<typeof successResponse> | ReturnType<typeof errorResponse>
  > = {
    201: successResponse(schema, description),
  }

  if (options.conflict) {
    responses[409] = errorResponse(
      typeof options.conflict === 'string' ? options.conflict : 'Resource conflict'
    )
  }

  if (options.businessError) {
    responses[422] = errorResponse(
      typeof options.businessError === 'string' ? options.businessError : 'Business rule violation'
    )
  }

  return responses
}

/**
 * 定义删除路由响应
 */
export function defineDeleteResponses(
  options: { notFound?: boolean | string } = {}
): Record<number, ReturnType<typeof successResponse> | ReturnType<typeof errorResponse>> {
  const responses: Record<
    number,
    ReturnType<typeof successResponse> | ReturnType<typeof errorResponse>
  > = {
    200: successResponse(z.object({ id: z.string() }), 'Deleted successfully'),
  }

  if (options.notFound) {
    responses[404] = errorResponse(
      typeof options.notFound === 'string' ? options.notFound : 'Resource not found'
    )
  }

  return responses
}

// ==================== 列表响应 ====================

export function listResponse<T extends z.ZodTypeAny>(itemSchema: T, description: string) {
  return successResponse(
    z.object({
      items: z.array(itemSchema),
      nextCursor: z.string().optional(),
    }),
    description
  )
}

// ==================== 请求配置快捷函数 ====================

export const idParam = z.object({ id: z.string() })

export const idRequest = { params: idParam }

export function bodyRequest<T extends z.ZodTypeAny>(schema: T) {
  return {
    body: {
      content: { 'application/json': { schema } },
    },
  }
}

export function queryRequest<T extends z.ZodObject<Record<string, z.ZodTypeAny>>>(schema: T) {
  return { query: schema }
}

// ==================== 统一响应辅助函数 ====================

export { success, created, list, deleted } from './response'
