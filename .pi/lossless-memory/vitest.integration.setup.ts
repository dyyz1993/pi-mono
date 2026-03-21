/**
 * 集成测试全局设置
 *
 * 为集成测试设置真实的数据库环境
 * 使用 Node.js 原生 node:sqlite 模块
 */

import { beforeAll } from 'vitest'

beforeAll(async () => {
  // 设置测试环境变量（如果未从外部传入）
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = ':memory:' // 内存数据库
  }
  if (!process.env.NODE_ENV) {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'test',
      writable: true,
      configurable: true,
    })
  }
})
