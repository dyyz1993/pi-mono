/**
 * Lossless Memory Service
 */

import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Project, SessionIndex, MemoryNode, OverviewStats } from '@shared/types'

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
// Service 函数
// ============================================================================

export async function getProjects(): Promise<Project[]> {
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
}

export async function getOverviewStats(): Promise<OverviewStats> {
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
}

export async function getSessions(projectPath?: string): Promise<SessionIndex[]> {
  const db = getDB()
  let sql = 'SELECT * FROM session_index'
  const params: any[] = []
  
  if (projectPath) {
    sql += ' WHERE session_path LIKE ?'
    params.push(`%${projectPath}%`)
  }
  
  sql += ' ORDER BY last_accessed DESC'
  
  const stmt = db.prepare(sql)
  return params.length > 0 ? stmt.all(...params) : stmt.all()
}

export async function getNodes(sessionId?: string, level?: number): Promise<MemoryNode[]> {
  const db = getDB()
  let sql = 'SELECT * FROM memory_nodes'
  const params: any[] = []
  const conditions: string[] = []

  if (sessionId) {
    conditions.push('session_id = ?')
    params.push(sessionId)
  }

  if (level !== undefined) {
    conditions.push('level = ?')
    params.push(level)
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ')
  }

  sql += ' ORDER BY level DESC, created_at ASC'

  const stmt = db.prepare(sql)
  const rows = params.length > 0 ? stmt.all(...params) : stmt.all()

  return rows.map((row: any) => ({
    ...row,
    parentIds: row.parent_ids ? JSON.parse(row.parent_ids) : [],
    childIds: row.child_ids ? JSON.parse(row.child_ids) : [],
    sessionEntryIds: row.session_entry_ids ? JSON.parse(row.session_entry_ids) : []
  }))
}
