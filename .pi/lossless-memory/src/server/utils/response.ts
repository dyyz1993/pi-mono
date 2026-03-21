/**
 * 统一 API 响应辅助函数
 *
 * 设计原则：
 * 1. 错误统一走 AppError + 全局处理器
 * 2. 成功响应由路由层用辅助函数包装，确保格式一致
 * 3. 业务层只返回业务数据，不包装响应
 */

export function success<T>(data: T) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  }
}

export function created<T>(data: T) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  }
}

export function list<T>(items: T[], count?: number) {
  return {
    success: true,
    data: count !== undefined ? { items, count } : { items },
    timestamp: new Date().toISOString(),
  }
}

export function deleted(id: string) {
  return {
    success: true,
    data: { id },
    timestamp: new Date().toISOString(),
  }
}
