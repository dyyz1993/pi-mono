/**
 * @framework-baseline
 * Lossless Memory RPC 服务
 */

import { createTypedRuntime } from '@server/core/typed-runtime'
import type { LosslessMemoryRPC } from '@shared/modules/lossless-memory'
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ============================================================================
// 数据库连接
// ============================================================================

const DB_PATH = join(homedir(), '.pi/agent/lossless-memory.db')
let db: DatabaseSync | null = null

function getDB(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH)
  }
  return db
}

// ============================================================================
// 类型安全的 RPC Runtime
// ============================================================================

const losslessRuntime = createTypedRuntime<LosslessMemoryRPC>('/api/lossless')

// ============================================================================
// RPC 方法实现
// ============================================================================

// 获取项目列表
losslessRuntime.registerRPC('getProjects', () => {
  const db = getDB()
  const stmt = db.prepare(`
    SELECT 
      session_path as path,
      COUNT(*) as sessionCount,
      COALESCE(SUM(node_count), 0) as messageCount,
      MAX(last_accessed) as lastActive
    FROM session_index
    GROUP BY session_path
    ORDER BY lastActive DESC
  `)
  
  const rows = stmt.all() as any[]
  return rows.map(row => ({
    ...row,
    name: row.path.split('/').pop() || 'Unknown',
    sessionCount: row.sessionCount || 0,
    messageCount: row.messageCount || 0,
    lastActive: row.lastAccessed || Date.now()
  }))
})

// 获取统计信息
losslessRuntime.registerRPC('getStats', () => {
  const db = getDB()
  
  const projects = db.prepare(
    'SELECT COUNT(DISTINCT session_path) as count FROM session_index'
  ).get() as { count: number }

  const sessions = db.prepare(
    'SELECT COUNT(*) as count FROM session_index'
  ).get() as { count: number }

  const nodes = db.prepare(
    'SELECT COUNT(*) as count FROM memory_nodes'
  ).get() as { count: number }

  const messages = db.prepare(
    'SELECT COUNT(*) as count FROM memory_nodes WHERE level = 0'
  ).get() as { count: number }

  const tokens = db.prepare(
    'SELECT COALESCE(SUM(token_count), 0) as total FROM memory_nodes'
  ).get() as { total: number }

  return {
    totalProjects: projects.count,
    totalSessions: sessions.count,
    totalNodes: nodes.count,
    totalMessages: messages.count,
    totalTokens: tokens.total
  }
})

// 获取会话列表
losslessRuntime.registerRPC('getSessions', (params) => {
  const db = getDB()
  let sql = 'SELECT * FROM session_index'
  const paramsArr: any[] = []
  
  if (params?.projectPath) {
    sql += ' WHERE session_path LIKE ?'
    paramsArr.push(`%${params.projectPath}%`)
  }
  
  sql += ' ORDER BY last_accessed DESC'
  
  const stmt = db.prepare(sql)
  return paramsArr.length > 0 ? stmt.all(...paramsArr) : stmt.all()
})

// 获取 DAG 节点
losslessRuntime.registerRPC('getNodes', (params) => {
  const db = getDB()
  let sql = 'SELECT * FROM memory_nodes'
  const paramsArr: any[] = []
  const conditions: string[] = []

  if (params?.sessionId) {
    conditions.push('session_id = ?')
    paramsArr.push(params.sessionId)
  }

  if (params?.level !== undefined) {
    conditions.push('level = ?')
    paramsArr.push(params.level)
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ')
  }

  sql += ' ORDER BY level DESC, created_at ASC'

  const stmt = db.prepare(sql)
  const rows = paramsArr.length > 0 ? stmt.all(...paramsArr) : stmt.all()

  return rows.map((row: any) => ({
    ...row,
    parentIds: row.parent_ids ? JSON.parse(row.parent_ids) : [],
    childIds: row.child_ids ? JSON.parse(row.child_ids) : [],
    sessionEntryIds: row.session_entry_ids ? JSON.parse(row.session_entry_ids) : []
  }))
})

// 搜索
losslessRuntime.registerRPC('search', (params) => {
  const db = getDB()
  const { query, limit = 20 } = params
  
  const stmt = db.prepare(`
    SELECT * FROM memory_nodes
    WHERE content LIKE ?
    ORDER BY level ASC, created_at DESC
    LIMIT ?
  `)
  
  const rows = stmt.all(`%${query}%`, limit)
  
  return rows.map((row: any) => ({
    node: {
      ...row,
      parentIds: row.parent_ids ? JSON.parse(row.parent_ids) : [],
      childIds: row.child_ids ? JSON.parse(row.child_ids) : [],
      sessionEntryIds: row.session_entry_ids ? JSON.parse(row.session_entry_ids) : []
    },
    score: 1.0,
    matchedKeywords: [query]
  }))
})

export { losslessRuntime }
