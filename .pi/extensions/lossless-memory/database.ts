/**
 * SQLite Database Layer using node:sqlite (Node 22+)
 */

import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import type {
  MemoryNode,
  SearchOptions,
  SearchResult,
  DatabaseInitResult,
  LosslessMemoryConfig,
} from "./types.js";

const SCHEMA = `
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

-- 普通索引替代 FTS5
CREATE INDEX IF NOT EXISTS idx_content ON memory_nodes(content);
CREATE INDEX IF NOT EXISTS idx_session ON memory_nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_level ON memory_nodes(level);
CREATE INDEX IF NOT EXISTS idx_created ON memory_nodes(created_at);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export class MemoryDatabase {
  private db: DatabaseSync | null = null;
  private config: LosslessMemoryConfig;
  private dbPath: string;

  constructor(config: LosslessMemoryConfig) {
    this.config = config;
    this.dbPath = this.resolvePath(config.database.path);
  }

  private resolvePath(dbPath: string): string {
    if (dbPath.startsWith("~")) {
      return path.join(os.homedir(), dbPath.slice(1));
    }
    return path.resolve(dbPath);
  }

  initialize(): DatabaseInitResult {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new DatabaseSync(this.dbPath);
      this.db.exec(SCHEMA);
      this.initMetadata();

      return { success: true, version: 1 };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        version: 0,
      };
    }
  }

  private initMetadata(): void {
    const stmt = this.db!.prepare(`
      INSERT OR IGNORE INTO metadata (key, value, updated_at)
      VALUES (?, ?, ?)
    `);
    stmt.run("schema_version", "1", Date.now());
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  insertNode(node: MemoryNode): void {
    const stmt = this.db!.prepare(`
      INSERT INTO memory_nodes (
        id, type, level, content, parent_ids, child_ids,
        created_at, token_count, session_id, session_entry_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      node.id, node.type, node.level, node.content,
      JSON.stringify(node.parentIds),
      JSON.stringify(node.childIds),
      node.createdAt, node.tokenCount, node.sessionId,
      JSON.stringify(node.sessionEntryIds),
    );
  }

  getNode(id: string): MemoryNode | null {
    const stmt = this.db!.prepare("SELECT * FROM memory_nodes WHERE id = ?");
    const row = stmt.get(id) as any;
    return row ? this.rowToNode(row) : null;
  }

  getNodesBySession(sessionId: string): MemoryNode[] {
    const stmt = this.db!.prepare(
      "SELECT * FROM memory_nodes WHERE session_id = ? ORDER BY created_at ASC"
    );
    return stmt.all(sessionId).map((r: any) => this.rowToNode(r));
  }

  getNodesByLevel(level: number): MemoryNode[] {
    const stmt = this.db!.prepare(
      "SELECT * FROM memory_nodes WHERE level = ? ORDER BY created_at ASC"
    );
    return stmt.all(level).map((r: any) => this.rowToNode(r));
  }

  getRootNodes(): MemoryNode[] {
    const stmt = this.db!.prepare(`
      SELECT * FROM memory_nodes 
      WHERE level = (SELECT MAX(level) FROM memory_nodes)
      ORDER BY created_at ASC
    `);
    return stmt.all().map((r: any) => this.rowToNode(r));
  }

  updateNode(node: MemoryNode): void {
    const stmt = this.db!.prepare(`
      UPDATE memory_nodes
      SET type = ?, level = ?, content = ?, parent_ids = ?, child_ids = ?,
          token_count = ?, session_entry_ids = ?
      WHERE id = ?
    `);
    stmt.run(
      node.type, node.level, node.content,
      JSON.stringify(node.parentIds),
      JSON.stringify(node.childIds),
      node.tokenCount,
      JSON.stringify(node.sessionEntryIds),
      node.id,
    );
  }

  deleteNodesBySession(sessionId: string): void {
    const stmt = this.db!.prepare(
      "DELETE FROM memory_nodes WHERE session_id = ?"
    );
    stmt.run(sessionId);
  }

  upsertSessionIndex(
    sessionId: string,
    sessionPath: string,
    nodeCount: number,
    totalTokens: number,
  ): void {
    const stmt = this.db!.prepare(`
      INSERT INTO session_index (
        session_id, session_path, created_at, last_accessed, node_count, total_tokens
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        node_count = excluded.node_count,
        total_tokens = excluded.total_tokens
    `);
    const now = Date.now();
    stmt.run(sessionId, sessionPath, now, now, nodeCount, totalTokens);
  }

  search(options: SearchOptions): SearchResult[] {
    const { query, sessionId, limit = 10, minLevel = 0 } = options;
    
    // 使用 LIKE 替代 FTS5
    let sql = `SELECT *, 1.0 as keyword_score FROM memory_nodes WHERE content LIKE ? AND level >= ?`;
    const params: any[] = [`%${query}%`, minLevel];
    
    if (sessionId) {
      sql += ` AND session_id = ?`;
      params.push(sessionId);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db!.prepare(sql);
    return stmt.all(...params).map((row: any) => ({
      node: this.rowToNode(row),
      score: {
        keyword: row.keyword_score,
        combined: row.keyword_score,
      },
    }));
  }

  getStats() {
    const nodeCount = this.db!.prepare(
      "SELECT COUNT(*) as count FROM memory_nodes"
    ).get() as { count: number };
    
    const sessionCount = this.db!.prepare(
      "SELECT COUNT(*) as count FROM session_index"
    ).get() as { count: number };
    
    const totalTokens = this.db!.prepare(
      "SELECT COALESCE(SUM(token_count), 0) as total FROM memory_nodes"
    ).get() as { total: number };
    
    const maxLevel = this.db!.prepare(
      "SELECT MAX(level) as max_level FROM memory_nodes"
    ).get() as { max_level: number | null };

    return {
      nodeCount: nodeCount.count,
      sessionCount: sessionCount.count,
      totalTokens: totalTokens.total,
      maxLevel: maxLevel.max_level || 0,
    };
  }

  private rowToNode(row: any): MemoryNode {
    return {
      id: row.id,
      type: row.type,
      level: row.level,
      content: row.content,
      parentIds: row.parent_ids ? JSON.parse(row.parent_ids) : [],
      childIds: row.child_ids ? JSON.parse(row.child_ids) : [],
      createdAt: row.created_at,
      tokenCount: row.token_count || 0,
      sessionId: row.session_id,
      sessionEntryIds: row.session_entry_ids ? JSON.parse(row.session_entry_ids) : [],
    };
  }
}
