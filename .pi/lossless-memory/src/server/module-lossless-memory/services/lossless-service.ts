/**
 * Lossless Memory Service
 */

import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import type { Project, SessionIndex, MemoryNode, OverviewStats } from '@shared/types'

const DB_PATH = join(homedir(), '.pi/agent/lossless-memory.db')
let db: DatabaseSync | null = null

function getDB(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH)
    initDB(db)
  }
  return db
}

function initDB(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS session_index (
      session_id TEXT PRIMARY KEY,
      session_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL,
      node_count INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS memory_nodes (
      id TEXT PRIMARY KEY,
      level INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      token_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_session_path ON session_index(session_path);
    CREATE INDEX IF NOT EXISTS idx_nodes_session ON memory_nodes(session_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_level ON memory_nodes(level);
  `)
  console.log('[LosslessService] ✅ 数据库表已初始化')
}

// 从会话文件读取实际的消息数
function countMessagesInFile(filePath: string): number {
  try {
    if (!existsSync(filePath)) return 0
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n').filter(l => l.trim())
    return lines.length
  } catch {
    return 0
  }
}

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
  
  const projects = db.prepare('SELECT COUNT(DISTINCT session_path) as count FROM session_index').get() as { count: number }
  const sessions = db.prepare('SELECT COUNT(*) as count FROM session_index').get() as { count: number }
  const nodes = db.prepare('SELECT COUNT(*) as count FROM memory_nodes').get() as { count: number }
  const messages = db.prepare('SELECT COUNT(*) as count FROM memory_nodes WHERE level = 0').get() as { count: number }
  const tokens = db.prepare('SELECT COALESCE(SUM(token_count), 0) as total FROM memory_nodes').get() as { total: number }

  return {
    totalProjects: projects.count,
    totalSessions: sessions.count,
    totalNodes: nodes.count,
    totalMessages: messages.count,
    totalTokens: tokens.total
  }
}

export async function getSessions(): Promise<any[]> {
  const db = getDB()
  const stmt = db.prepare(`
    SELECT 
      session_path as path,
      session_id as id,
      node_count as messageCount,
      last_accessed as lastActive
    FROM session_index
    ORDER BY last_accessed DESC
  `)
  
  const sessions = stmt.all() as any[]
  
  // 从实际文件读取消息数
  return sessions.map(session => ({
    ...session,
    messageCount: countMessagesInFile(session.path)
  }))
}

export async function getNodes(): Promise<any[]> {
  const db = getDB()
  const stmt = db.prepare(`
    SELECT 
      id,
      level,
      type,
      content,
      token_count as tokenCount,
      session_id as sessionId,
      created_at as createdAt
    FROM memory_nodes
    ORDER BY level ASC, created_at ASC
  `)
  return stmt.all() as any[]
}

// 从会话文件读取消息
export async function getMessages(sessionPath: string): Promise<any[]> {
  try {
    const { readFileSync, existsSync } = await import('node:fs')
    if (!existsSync(sessionPath)) return []
    
    const content = readFileSync(sessionPath, 'utf-8')
    const lines = content.trim().split('\n').filter(l => l.trim())
    
    const messages = []
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'message' && entry.message) {
          messages.push({
            id: entry.id,
            role: entry.message.role,
            content: entry.message.content?.[0]?.text || '',
            timestamp: entry.timestamp || Date.now()
          })
        }
      } catch {}
    }
    return messages
  } catch {
    return []
  }
}
