/**
 * Lossless Memory Service
 * 监听 pi 扩展事件，存储 DAG 数据
 */

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';

const DB_PATH = join(homedir(), '.pi/agent/lossless-memory.db');

export class LosslessMemoryService {
  private db: DatabaseSync | null = null;

  constructor() {
    this.initDB();
  }

  private initDB() {
    try {
      if (!existsSync(DB_PATH)) {
        const dir = join(DB_PATH, '..');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      }
      
      this.db = new DatabaseSync(DB_PATH);
      this.createTables();
      console.log('[LosslessMemory] Database initialized');
    } catch (error) {
      console.error('[LosslessMemory] DB init failed:', error);
    }
  }

  private createTables() {
    if (!this.db) return;
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        level INTEGER NOT NULL,
        content TEXT NOT NULL,
        parent_ids TEXT,
        child_ids TEXT,
        created_at INTEGER NOT NULL,
        token_count INTEGER,
        session_id TEXT NOT NULL,
        session_entry_ids TEXT
      );
      CREATE TABLE IF NOT EXISTS session_index (
        session_id TEXT PRIMARY KEY,
        session_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        node_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0
      );
    `);
  }

  // 插件抛出事件：节点创建
  public onNodeCreated(node: {
    id: string;
    type: string;
    level: number;
    content: string;
    parentIds?: string[];
    childIds?: string[];
    sessionId: string;
    sessionEntryIds?: string[];
    tokenCount?: number;
  }) {
    if (!this.db) return;
    
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO memory_nodes 
        (id, type, level, content, parent_ids, child_ids, created_at, token_count, session_id, session_entry_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        node.id, node.type, node.level, node.content,
        JSON.stringify(node.parentIds || []),
        JSON.stringify(node.childIds || []),
        Date.now(),
        node.tokenCount || 0,
        node.sessionId,
        JSON.stringify(node.sessionEntryIds || [])
      );
      
      console.log(`[LosslessMemory] Node created: L${node.level} ${node.id.slice(0, 8)}...`);
    } catch (error) {
      console.error('[LosslessMemory] Failed to create node:', error);
    }
  }

  // 插件抛出事件：会话开始
  public onSessionStart(sessionId: string, sessionPath: string) {
    if (!this.db) return;
    
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO session_index 
        (session_id, session_path, created_at, last_accessed, node_count, total_tokens)
        VALUES (?, ?, ?, ?, 0, 0)
      `);
      
      stmt.run(sessionId, sessionPath, Date.now(), Date.now());
    } catch (error) {
      console.error('[LosslessMemory] Failed to start session:', error);
    }
  }

  // 获取所有节点
  public getNodes() {
    if (!this.db) return [];
    
    try {
      const rows = this.db.prepare('SELECT * FROM memory_nodes ORDER BY level DESC').all();
      return rows.map((r: any) => ({
        id: r.id,
        level: r.level,
        type: r.type,
        content: r.content,
        tokenCount: r.token_count || 0,
        childIds: r.child_ids ? JSON.parse(r.child_ids) : [],
        sessionEntryIds: r.session_entry_ids ? JSON.parse(r.session_entry_ids) : []
      }));
    } catch (error) {
      return [];
    }
  }

  // 获取会话列表
  public getSessions() {
    if (!this.db) return [];
    
    try {
      return this.db.prepare('SELECT * FROM session_index ORDER BY last_accessed DESC').all();
    } catch (error) {
      return [];
    }
  }

  // 获取统计
  public getStats() {
    const nodes = this.getNodes();
    const sessions = this.getSessions();
    
    return {
      nodeCount: nodes.length,
      maxLevel: nodes.reduce((m, n) => Math.max(m, n.level || 0), 0),
      totalTokens: nodes.reduce((s, n) => s + n.tokenCount, 0),
      sessionCount: sessions.length
    };
  }
}

export const losslessMemoryService = new LosslessMemoryService();
