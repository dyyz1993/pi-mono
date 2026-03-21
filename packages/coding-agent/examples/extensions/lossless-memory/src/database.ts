/**
 * SQLite Database Layer for Lossless Memory Extension
 *
 * Manages database initialization, schema, and CRUD operations.
 * Supports FTS5 full-text search and optional vector embeddings.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type Database from "better-sqlite3";

const DatabaseCtor = require("better-sqlite3") as typeof Database;

import type {
	DatabaseInitResult,
	LosslessMemoryConfig,
	MemoryNode,
	MemoryNodeRow,
	SearchOptions,
	SearchResult,
	SessionIndexRow,
} from "./types.js";

// ============================================================================
// Database Schema
// ============================================================================

const SCHEMA = `
-- Memory nodes table (DAG nodes)
CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('summary', 'original')),
  level INTEGER NOT NULL CHECK (level >= 0),
  content TEXT NOT NULL,
  parent_ids TEXT,
  child_ids TEXT,
  created_at INTEGER NOT NULL,
  token_count INTEGER,
  session_id TEXT NOT NULL,
  session_entry_ids TEXT
);

-- Session index for cross-session queries
CREATE TABLE IF NOT EXISTS session_index (
  session_id TEXT PRIMARY KEY,
  session_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  node_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  session_id,
  level,
  content='memory_nodes',
  content_rowid='rowid'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS memory_nodes_ai AFTER INSERT ON memory_nodes BEGIN
  INSERT INTO memory_fts(rowid, content, session_id, level) 
  VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.level);
END;

CREATE TRIGGER IF NOT EXISTS memory_nodes_ad AFTER DELETE ON memory_nodes BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content, session_id, level) 
  VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.level);
END;

CREATE TRIGGER IF NOT EXISTS memory_nodes_au AFTER UPDATE ON memory_nodes BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content, session_id, level) 
  VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.level);
  INSERT INTO memory_fts(rowid, content, session_id, level) 
  VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.level);
END;

-- Vector embeddings table (optional, for semantic search)
CREATE TABLE IF NOT EXISTS memory_embeddings (
  node_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  FOREIGN KEY (node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_nodes_session ON memory_nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_nodes_level ON memory_nodes(level);
CREATE INDEX IF NOT EXISTS idx_nodes_created ON memory_nodes(created_at);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON memory_nodes(type);
CREATE INDEX IF NOT EXISTS idx_embeddings_node ON memory_embeddings(node_id);

-- Metadata table for extension state
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

// ============================================================================
// Database Class
// ============================================================================

export class MemoryDatabase {
	private db: any = null;
	private config: LosslessMemoryConfig;
	private dbPath: string;

	constructor(config: LosslessMemoryConfig) {
		this.config = config;
		this.dbPath = this.resolvePath(config.database.path);
	}

	/**
	 * Resolve path, expanding ~ to home directory
	 */
	private resolvePath(dbPath: string): string {
		if (dbPath.startsWith("~")) {
			return path.join(os.homedir(), dbPath.slice(1));
		}
		return path.resolve(dbPath);
	}

	/**
	 * Initialize database connection and schema
	 */
	initialize(): DatabaseInitResult {
		try {
			// Ensure directory exists
			const dir = path.dirname(this.dbPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			// Open database
			this.db = new DatabaseCtor(this.dbPath);

			// Enable WAL mode for better concurrency
			this.db.pragma("journal_mode = WAL");

			// Enable foreign keys
			this.db.pragma("foreign_keys = ON");

			// Set busy timeout
			this.db.pragma("busy_timeout = 5000");

			// Initialize schema
			this.db.exec(SCHEMA);

			// Initialize metadata
			this.initMetadata();

			return {
				success: true,
				version: this.getSchemaVersion(),
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: errorMessage,
				version: 0,
			};
		}
	}

	/**
	 * Initialize metadata table
	 */
	private initMetadata(): void {
		const stmt = this.db!.prepare(`
      INSERT OR IGNORE INTO metadata (key, value, updated_at)
      VALUES (?, ?, ?)
    `);

		const version = Date.now();
		stmt.run("schema_version", "1", version);
		stmt.run("initialized_at", new Date().toISOString(), version);
	}

	/**
	 * Get schema version from metadata
	 */
	private getSchemaVersion(): number {
		const stmt = this.db!.prepare("SELECT value FROM metadata WHERE key = 'schema_version'");
		const row = stmt.get() as { value: string } | undefined;
		return row ? parseInt(row.value, 10) : 0;
	}

	/**
	 * Close database connection
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	/**
	 * Check if database is open
	 */
	isOpen(): boolean {
		return this.db !== null;
	}

	// ============================================================================
	// Memory Node CRUD Operations
	// ============================================================================

	/**
	 * Insert a memory node
	 */
	insertNode(node: MemoryNode): void {
		const stmt = this.db!.prepare(`
      INSERT INTO memory_nodes (
        id, type, level, content, parent_ids, child_ids,
        created_at, token_count, session_id, session_entry_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			node.id,
			node.type,
			node.level,
			node.content,
			JSON.stringify(node.parentIds),
			JSON.stringify(node.childIds),
			node.createdAt,
			node.tokenCount,
			node.sessionId,
			JSON.stringify(node.sessionEntryIds),
		);
	}

	/**
	 * Insert multiple nodes in a transaction
	 */
	insertNodes(nodes: MemoryNode[]): void {
		const transaction = this.db!.transaction((nodes: MemoryNode[]) => {
			const stmt = this.db!.prepare(`
        INSERT INTO memory_nodes (
          id, type, level, content, parent_ids, child_ids,
          created_at, token_count, session_id, session_entry_ids
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

			for (const node of nodes) {
				stmt.run(
					node.id,
					node.type,
					node.level,
					node.content,
					JSON.stringify(node.parentIds),
					JSON.stringify(node.childIds),
					node.createdAt,
					node.tokenCount,
					node.sessionId,
					JSON.stringify(node.sessionEntryIds),
				);
			}
		});

		transaction(nodes);
	}

	/**
	 * Get node by ID
	 */
	getNode(id: string): MemoryNode | null {
		const stmt = this.db!.prepare("SELECT * FROM memory_nodes WHERE id = ?");
		const row = stmt.get(id) as MemoryNodeRow | undefined;

		if (!row) return null;

		return this.rowToNode(row);
	}

	/**
	 * Get nodes by session ID
	 */
	getNodesBySession(sessionId: string): MemoryNode[] {
		const stmt = this.db!.prepare(
			"SELECT * FROM memory_nodes WHERE session_id = ? ORDER BY level ASC, created_at ASC",
		);
		const rows = stmt.all(sessionId) as MemoryNodeRow[];
		return rows.map((row) => this.rowToNode(row));
	}

	/**
	 * Get nodes by level
	 */
	getNodesByLevel(level: number): MemoryNode[] {
		const stmt = this.db!.prepare("SELECT * FROM memory_nodes WHERE level = ? ORDER BY created_at ASC");
		const rows = stmt.all(level) as MemoryNodeRow[];
		return rows.map((row) => this.rowToNode(row));
	}

	/**
	 * Get root nodes (highest level summaries)
	 */
	getRootNodes(): MemoryNode[] {
		const stmt = this.db!.prepare(`
      SELECT * FROM memory_nodes 
      WHERE level = (SELECT MAX(level) FROM memory_nodes)
      ORDER BY created_at ASC
    `);
		const rows = stmt.all() as MemoryNodeRow[];
		return rows.map((row) => this.rowToNode(row));
	}

	/**
	 * Update node
	 */
	updateNode(node: MemoryNode): void {
		const stmt = this.db!.prepare(`
      UPDATE memory_nodes
      SET type = ?, level = ?, content = ?, parent_ids = ?, child_ids = ?,
          token_count = ?, session_entry_ids = ?
      WHERE id = ?
    `);

		stmt.run(
			node.type,
			node.level,
			node.content,
			JSON.stringify(node.parentIds),
			JSON.stringify(node.childIds),
			node.tokenCount,
			JSON.stringify(node.sessionEntryIds),
			node.id,
		);
	}

	/**
	 * Delete node by ID
	 */
	deleteNode(id: string): void {
		const stmt = this.db!.prepare("DELETE FROM memory_nodes WHERE id = ?");
		stmt.run(id);
	}

	/**
	 * Delete nodes by session ID
	 */
	deleteNodesBySession(sessionId: string): void {
		const transaction = this.db!.transaction((sessionId: string) => {
			const deleteEmbeddings = this.db!.prepare(
				"DELETE FROM memory_embeddings WHERE node_id IN (SELECT id FROM memory_nodes WHERE session_id = ?)",
			);
			deleteEmbeddings.run(sessionId);

			const deleteNodes = this.db!.prepare("DELETE FROM memory_nodes WHERE session_id = ?");
			deleteNodes.run(sessionId);

			const deleteSession = this.db!.prepare("DELETE FROM session_index WHERE session_id = ?");
			deleteSession.run(sessionId);
		});

		transaction(sessionId);
	}

	// ============================================================================
	// Session Index Operations
	// ============================================================================

	/**
	 * Update or insert session index
	 */
	upsertSessionIndex(sessionId: string, sessionPath: string, nodeCount: number, totalTokens: number): void {
		const stmt = this.db!.prepare(`
      INSERT INTO session_index (
        session_id, session_path, created_at, last_accessed, node_count, total_tokens
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        session_path = excluded.session_path,
        last_accessed = excluded.last_accessed,
        node_count = excluded.node_count,
        total_tokens = excluded.total_tokens
    `);

		const now = Date.now();
		stmt.run(sessionId, sessionPath, now, now, nodeCount, totalTokens);
	}

	/**
	 * Get session index
	 */
	getSessionIndex(sessionId: string): SessionIndexRow | null {
		const stmt = this.db!.prepare("SELECT * FROM session_index WHERE session_id = ?");
		return stmt.get(sessionId) as SessionIndexRow | null;
	}

	/**
	 * Get all session indexes
	 */
	getAllSessionIndexes(): SessionIndexRow[] {
		const stmt = this.db!.prepare("SELECT * FROM session_index ORDER BY last_accessed DESC");
		return stmt.all() as SessionIndexRow[];
	}

	// ============================================================================
	// Search Operations (FTS5)
	// ============================================================================

	/**
	 * Full-text search using FTS5
	 */
	search(options: SearchOptions): SearchResult[] {
		const { query, sessionId, limit = 10, minLevel = 0, maxLevel } = options;

		// Build FTS5 query
		let ftsQuery = query;
		if (sessionId) {
			ftsQuery = `${ftsQuery} AND session_id:"${sessionId}"`;
		}
		if (maxLevel !== undefined) {
			ftsQuery = `${ftsQuery} AND level <= ${maxLevel}`;
		}

		// FTS5 search with BM25 scoring
		const stmt = this.db!.prepare(`
      SELECT mn.*, bm25(memory_fts) as keyword_score
      FROM memory_fts
      JOIN memory_nodes mn ON mn.rowid = memory_fts.rowid
      WHERE memory_fts MATCH ?
      AND mn.level >= ?
      ORDER BY keyword_score DESC
      LIMIT ?
    `);

		const rows = stmt.all(ftsQuery, minLevel, limit) as (MemoryNodeRow & { keyword_score: number })[];

		return rows.map((row) => ({
			node: this.rowToNode(row),
			score: {
				keyword: Math.abs(row.keyword_score), // BM25 scores are negative
				combined: Math.abs(row.keyword_score),
			},
		}));
	}

	/**
	 * Search with highlight extraction
	 */
	searchWithHighlights(options: SearchOptions, snippetSize = 100): SearchResult[] {
		const baseResults = this.search(options);

		// Extract snippets using FTS5 snippet function
		const stmt = this.db!.prepare(`
      SELECT mn.id, snippet(memory_fts, 0, '【', '】', '...', ?) as snippet
      FROM memory_fts
      JOIN memory_nodes mn ON mn.rowid = memory_fts.rowid
      WHERE memory_fts MATCH ?
    `);

		const ftsQuery = options.query;
		const snippetRows = stmt.all(snippetSize, ftsQuery) as { id: string; snippet: string }[];

		const snippetMap = new Map(snippetRows.map((r) => [r.id, r.snippet]));

		return baseResults.map((result) => ({
			...result,
			highlights: snippetMap.get(result.node.id) ? [snippetMap.get(result.node.id)!] : [],
		}));
	}

	/**
	 * Vector similarity search (requires embeddings)
	 */
	vectorSearch(embedding: number[], limit = 10): SearchResult[] {
		if (!this.config.database.enableVectors) {
			throw new Error("Vector search is not enabled");
		}

		// Convert embedding to buffer
		const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);

		// Cosine similarity search
		const stmt = this.db!.prepare(`
      SELECT mn.*, 
             (
               SELECT SUM(mn_vec.embedding * ?) / 
                    (sqrt(SUM(mn_vec.embedding * mn_vec.embedding)) * sqrt(?))
               FROM memory_embeddings mn_vec
               WHERE mn_vec.node_id = mn.id
             ) as semantic_score
      FROM memory_nodes mn
      JOIN memory_embeddings emb ON emb.node_id = mn.id
      WHERE emb.dimensions = ?
      ORDER BY semantic_score DESC
      LIMIT ?
    `);

		const normSquared = embedding.reduce((sum, v) => sum + v * v, 0);
		const rows = stmt.all(embeddingBuffer, normSquared, embedding.length, limit) as (MemoryNodeRow & {
			semantic_score: number;
		})[];

		return rows
			.filter((row) => row.semantic_score !== null)
			.map((row) => ({
				node: this.rowToNode(row),
				score: {
					keyword: 0,
					semantic: row.semantic_score,
					combined: row.semantic_score,
				},
			}));
	}

	/**
	 * Hybrid search (keyword + semantic)
	 */
	hybridSearch(options: SearchOptions, embedding?: number[]): SearchResult[] {
		const keywordResults = this.search(options);

		if (!embedding || !this.config.database.enableVectors) {
			return keywordResults;
		}

		try {
			const semanticResults = this.vectorSearch(embedding, options.limit);

			// Create score maps
			const keywordScores = new Map(keywordResults.map((r, i) => [r.node.id, { result: r, rank: i + 1 }]));
			const semanticScores = new Map(semanticResults.map((r, i) => [r.node.id, { result: r, rank: i + 1 }]));

			// Combine scores with reciprocal rank fusion
			const allIds = new Set([...keywordScores.keys(), ...semanticScores.keys()]);
			const combined: SearchResult[] = [];

			const keywordWeight = this.config.search.keywordWeight;
			const semanticWeight = this.config.search.semanticWeight;

			for (const id of allIds) {
				const keywordData = keywordScores.get(id);
				const semanticData = semanticScores.get(id);

				let combinedScore = 0;
				let node: MemoryNode;

				if (keywordData && semanticData) {
					// Reciprocal rank fusion
					combinedScore =
						keywordWeight * (1 / (keywordData.rank + 60)) + semanticWeight * (1 / (semanticData.rank + 60));
					node = keywordData.result.node;
				} else if (keywordData) {
					combinedScore = keywordWeight * (1 / (keywordData.rank + 60));
					node = keywordData.result.node;
				} else if (semanticData) {
					combinedScore = semanticWeight * (1 / (semanticData.rank + 60));
					node = semanticData.result.node;
				} else {
					continue;
				}

				combined.push({
					node,
					score: {
						keyword: keywordData?.result.score.keyword || 0,
						semantic: semanticData?.result.score.semantic,
						combined: combinedScore,
					},
				});
			}

			// Sort by combined score
			combined.sort((a, b) => b.score.combined - a.score.combined);

			return combined.slice(0, options.limit || 10);
		} catch (error) {
			// Fall back to keyword-only search on error
			return keywordResults;
		}
	}

	// ============================================================================
	// Embedding Operations (Optional)
	// ============================================================================

	/**
	 * Store embedding for a node
	 */
	storeEmbedding(nodeId: string, embedding: number[], model: string): void {
		if (!this.config.database.enableVectors) {
			throw new Error("Vector embeddings are not enabled");
		}

		const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);

		const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO memory_embeddings (node_id, embedding, model, dimensions)
      VALUES (?, ?, ?, ?)
    `);

		stmt.run(nodeId, embeddingBuffer, model, embedding.length);
	}

	/**
	 * Get embedding for a node
	 */
	getEmbedding(nodeId: string): number[] | null {
		const stmt = this.db!.prepare("SELECT embedding FROM memory_embeddings WHERE node_id = ?");
		const row = stmt.get(nodeId) as { embedding: Buffer } | undefined;

		if (!row) return null;

		const float32 = new Float32Array(row.embedding.buffer);
		return Array.from(float32);
	}

	/**
	 * Delete embedding for a node
	 */
	deleteEmbedding(nodeId: string): void {
		const stmt = this.db!.prepare("DELETE FROM memory_embeddings WHERE node_id = ?");
		stmt.run(nodeId);
	}

	// ============================================================================
	// Statistics and Maintenance
	// ============================================================================

	/**
	 * Get database statistics
	 */
	getStats() {
		const nodeCount = this.db!.prepare("SELECT COUNT(*) as count FROM memory_nodes").get() as { count: number };

		const sessionCount = this.db!.prepare("SELECT COUNT(*) as count FROM session_index").get() as { count: number };

		const embeddingCount = this.db!.prepare("SELECT COUNT(*) as count FROM memory_embeddings").get() as {
			count: number;
		};

		const totalTokens = this.db!.prepare("SELECT COALESCE(SUM(token_count), 0) as total FROM memory_nodes").get() as {
			total: number;
		};

		const maxLevel = this.db!.prepare("SELECT MAX(level) as max_level FROM memory_nodes").get() as {
			max_level: number | null;
		};

		return {
			nodeCount: nodeCount.count,
			sessionCount: sessionCount.count,
			embeddingCount: embeddingCount.count,
			totalTokens: totalTokens.total,
			maxLevel: maxLevel.max_level || 0,
		};
	}

	/**
	 * Run database vacuum for optimization
	 */
	vacuum(): void {
		this.db!.exec("VACUUM");
	}

	/**
	 * Run integrity check
	 */
	integrityCheck(): { ok: boolean; errors?: string[] } {
		try {
			const result = this.db!.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
			const errors = result.map((r) => r.integrity_check).filter((msg) => msg !== "ok");

			return {
				ok: errors.length === 0,
				errors: errors.length > 0 ? errors : undefined,
			};
		} catch (error) {
			return {
				ok: false,
				errors: [error instanceof Error ? error.message : String(error)],
			};
		}
	}

	// ============================================================================
	// Utility Methods
	// ============================================================================

	/**
	 * Convert database row to MemoryNode
	 */
	private rowToNode(row: MemoryNodeRow): MemoryNode {
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

	/**
	 * Get raw database instance (for advanced operations)
	 */
	getRawDatabase(): any {
		return this.db;
	}
}
