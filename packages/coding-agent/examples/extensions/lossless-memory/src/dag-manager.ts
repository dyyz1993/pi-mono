/**
 * DAG Manager for Lossless Memory Extension
 *
 * Manages the Directed Acyclic Graph structure of memory nodes.
 * Handles node creation, linking, and hierarchical summary management.
 */

import { v4 as uuidv4 } from "uuid";
import type { MemoryDatabase } from "./database.js";
import type { CompressionPreparation, DAGState, LosslessMemoryConfig, MemoryNode } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const COMPRESSION_RULES = {
	1: { compressEvery: 8, targetTokens: 200 },
	2: { compressEvery: 4, targetTokens: 300 },
	3: { compressEvery: 4, targetTokens: 500 },
	4: { compressEvery: 4, targetTokens: 800 },
};

const MAX_LEVEL = 4;

// ============================================================================
// DAG Manager Class
// ============================================================================

export class DAGManager {
	private db: MemoryDatabase;
	private state: DAGState;
	private config: LosslessMemoryConfig;

	constructor(db: MemoryDatabase, config: LosslessMemoryConfig) {
		this.db = db;
		this.config = config;
		this.state = {
			sessionId: undefined,
			nodes: new Map(),
			entryToNode: new Map(),
			rootNodes: [],
		};
	}

	// ============================================================================
	// Initialization and Session Management
	// ============================================================================

	/**
	 * Initialize DAG manager for a session
	 */
	async initializeForSession(sessionId: string): Promise<void> {
		this.state.sessionId = sessionId;
		this.state.nodes.clear();
		this.state.entryToNode.clear();
		this.state.rootNodes = [];

		// Load nodes from database
		const nodes = this.db.getNodesBySession(sessionId);
		for (const node of nodes) {
			this.state.nodes.set(node.id, node);
			for (const entryId of node.sessionEntryIds) {
				this.state.entryToNode.set(entryId, node.id);
			}
		}

		// Find root nodes
		this.state.rootNodes = this.db.getRootNodes().map((n) => n.id);
	}

	/**
	 * Clear session state
	 */
	clearSession(): void {
		this.state.sessionId = undefined;
		this.state.nodes.clear();
		this.state.entryToNode.clear();
		this.state.rootNodes = [];
	}

	// ============================================================================
	// Node Creation and Management
	// ============================================================================

	/**
	 * Create a new memory node
	 */
	createNode(params: {
		type: MemoryNode["type"];
		level: number;
		content: string;
		childIds?: string[];
		sessionEntryIds?: string[];
		tokenCount?: number;
	}): MemoryNode {
		const node: MemoryNode = {
			id: uuidv4(),
			type: params.type,
			level: params.level,
			content: params.content,
			parentIds: [],
			childIds: params.childIds || [],
			createdAt: Date.now(),
			tokenCount: params.tokenCount || this.estimateTokens(params.content),
			sessionId: this.state.sessionId!,
			sessionEntryIds: params.sessionEntryIds || [],
		};

		// Save to database
		this.db.insertNode(node);

		// Update cache
		this.state.nodes.set(node.id, node);
		for (const entryId of node.sessionEntryIds) {
			this.state.entryToNode.set(entryId, node.id);
		}

		// Update root nodes if this is highest level
		if (params.level >= this.getMaxLevel()) {
			this.state.rootNodes.push(node.id);
		}

		return node;
	}

	/**
	 * Create a summary node from entries
	 */
	async createSummaryNode(
		entries: Array<{ id: string; content: string }>,
		summary: string,
		level: number = 1,
	): Promise<MemoryNode> {
		const childIds: string[] = [];
		const sessionEntryIds: string[] = [];

		// Find or create child nodes
		for (const entry of entries) {
			sessionEntryIds.push(entry.id);

			// Check if there's already a node for this entry
			const existingNodeId = this.state.entryToNode.get(entry.id);
			if (existingNodeId) {
				childIds.push(existingNodeId);
			}
		}

		const node = this.createNode({
			type: "summary",
			level,
			content: summary,
			childIds,
			sessionEntryIds,
			tokenCount: this.estimateTokens(summary),
		});

		// Update parent references in child nodes
		for (const childId of childIds) {
			const child = this.state.nodes.get(childId);
			if (child && !child.parentIds.includes(node.id)) {
				child.parentIds.push(node.id);
				this.db.updateNode(child);
			}
		}

		// Check if we should create higher-level summary
		await this.maybeCreateHigherLevelSummary(level);

		return node;
	}

	/**
	 * Maybe create a higher-level summary if enough nodes exist
	 */
	private async maybeCreateHigherLevelSummary(currentLevel: number): Promise<void> {
		if (currentLevel >= MAX_LEVEL) {
			return;
		}

		const nextLevel = currentLevel + 1;
		const rule = COMPRESSION_RULES[nextLevel as keyof typeof COMPRESSION_RULES];
		if (!rule) return;

		// Get nodes at current level
		const currentLevelNodes = this.db
			.getNodesByLevel(currentLevel)
			.filter((n) => n.sessionId === this.state.sessionId);

		// Check if we have enough to compress
		if (currentLevelNodes.length < rule.compressEvery) {
			return;
		}

		// Group nodes for compression
		const groups: MemoryNode[][] = [];
		for (let i = 0; i < currentLevelNodes.length; i += rule.compressEvery) {
			groups.push(currentLevelNodes.slice(i, i + rule.compressEvery));
		}

		// Create higher-level summaries for each group
		for (const group of groups) {
			const combinedContent = group.map((n) => n.content).join("\n\n");

			// Simple concatenation for now (summary generator will be called externally)
			const higherNode = this.createNode({
				type: "summary",
				level: nextLevel,
				content: combinedContent,
				childIds: group.map((n) => n.id),
				sessionEntryIds: group.flatMap((n) => n.sessionEntryIds),
			});

			// Update parent references
			for (const child of group) {
				if (!child.parentIds.includes(higherNode.id)) {
					child.parentIds.push(higherNode.id);
					this.db.updateNode(child);
				}
			}
		}
	}

	// ============================================================================
	// Node Retrieval
	// ============================================================================

	/**
	 * Get node by ID
	 */
	getNode(id: string): MemoryNode | null {
		return this.state.nodes.get(id) || this.db.getNode(id);
	}

	/**
	 * Get node for an entry
	 */
	getNodeForEntry(entryId: string): MemoryNode | null {
		const nodeId = this.state.entryToNode.get(entryId);
		if (!nodeId) return null;
		return this.getNode(nodeId);
	}

	/**
	 * Get all nodes for a session
	 */
	getSessionNodes(): MemoryNode[] {
		if (!this.state.sessionId) return [];
		return this.db.getNodesBySession(this.state.sessionId);
	}

	/**
	 * Get root nodes (highest level summaries)
	 */
	getRootNodes(): MemoryNode[] {
		return this.state.rootNodes.map((id) => this.getNode(id)).filter(Boolean) as MemoryNode[];
	}

	/**
	 * Get maximum level in the DAG
	 */
	getMaxLevel(): number {
		const nodes = this.getSessionNodes();
		if (nodes.length === 0) return 0;
		return Math.max(...nodes.map((n) => n.level));
	}

	/**
	 * Get nodes by level
	 */
	getNodesByLevel(level: number): MemoryNode[] {
		return this.db.getNodesByLevel(level).filter((n) => n.sessionId === this.state.sessionId);
	}

	// ============================================================================
	// DAG Traversal
	// ============================================================================

	/**
	 * Get all ancestors of a node (parents, grandparents, etc.)
	 */
	getAncestors(nodeId: string, maxDepth: number = -1): MemoryNode[] {
		const ancestors: MemoryNode[] = [];
		const visited = new Set<string>();
		const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

		while (queue.length > 0) {
			const { id, depth } = queue.shift()!;

			if (visited.has(id)) continue;
			visited.add(id);

			if (id !== nodeId) {
				const node = this.getNode(id);
				if (node) ancestors.push(node);
			}

			if (maxDepth >= 0 && depth >= maxDepth) continue;

			const node = this.getNode(id);
			if (node) {
				for (const parentId of node.parentIds) {
					queue.push({ id: parentId, depth: depth + 1 });
				}
			}
		}

		return ancestors;
	}

	/**
	 * Get all descendants of a node (children, grandchildren, etc.)
	 */
	getDescendants(nodeId: string, maxDepth: number = -1): MemoryNode[] {
		const descendants: MemoryNode[] = [];
		const visited = new Set<string>();
		const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

		while (queue.length > 0) {
			const { id, depth } = queue.shift()!;

			if (visited.has(id)) continue;
			visited.add(id);

			if (id !== nodeId) {
				const node = this.getNode(id);
				if (node) descendants.push(node);
			}

			if (maxDepth >= 0 && depth >= maxDepth) continue;

			const node = this.getNode(id);
			if (node) {
				for (const childId of node.childIds) {
					queue.push({ id: childId, depth: depth + 1 });
				}
			}
		}

		return descendants;
	}

	/**
	 * Trace down from a summary node to original entries
	 */
	async traceToOriginals(nodeId: string, maxDepth: number = 10): Promise<MemoryNode[]> {
		const originals: MemoryNode[] = [];
		const visited = new Set<string>();
		const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

		while (queue.length > 0) {
			const { id, depth } = queue.shift()!;

			if (visited.has(id)) continue;
			visited.add(id);

			if (depth > maxDepth) continue;

			const node = this.getNode(id);
			if (!node) continue;

			if (node.type === "original" || node.childIds.length === 0) {
				// This is a leaf node (original message)
				originals.push(node);
			} else {
				// Continue traversing down
				for (const childId of node.childIds) {
					queue.push({ id: childId, depth: depth + 1 });
				}
			}
		}

		return originals;
	}

	// ============================================================================
	// Compression Preparation
	// ============================================================================

	/**
	 * Prepare entries for compression
	 */
	prepareCompression(entries: Array<{ id: string; role: string; content: string }>): CompressionPreparation {
		const rule = COMPRESSION_RULES[1]; // Start with L1 compression

		// Get entries to compress (oldest entries first)
		const entriesToCompress = entries.slice(0, rule.compressEvery);
		const firstKeptEntryId = entries[rule.compressEvery]?.id || entries[entries.length - 1]?.id;

		// Estimate tokens
		const tokensBefore = entries.reduce((sum, e) => sum + this.estimateTokens(e.content), 0);

		return {
			entriesToCompress,
			firstKeptEntryId,
			tokensBefore,
		};
	}

	/**
	 * Check if compression is needed
	 */
	needsCompression(entryCount: number): boolean {
		const rule = COMPRESSION_RULES[1];
		return entryCount >= rule.compressEvery;
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	/**
	 * Get DAG statistics
	 */
	getStats(): {
		nodeCount: number;
		maxLevel: number;
		rootCount: number;
		totalTokens: number;
		entryCoverage: number;
	} {
		const nodes = this.getSessionNodes();
		const maxLevel = this.getMaxLevel();
		const rootNodes = this.getRootNodes();
		const totalTokens = nodes.reduce((sum, n) => sum + (n.tokenCount || 0), 0);
		const entryCoverage = this.state.entryToNode.size;

		return {
			nodeCount: nodes.length,
			maxLevel,
			rootCount: rootNodes.length,
			totalTokens,
			entryCoverage,
		};
	}

	/**
	 * Get node count
	 */
	getNodeCount(): number {
		return this.getSessionNodes().length;
	}

	// ============================================================================
	// Cleanup
	// ============================================================================

	/**
	 * Delete the current session's data
	 */
	deleteSession(): void {
		if (this.state.sessionId) {
			this.db.deleteNodesBySession(this.state.sessionId);
		}
		this.clearSession();
	}

	/**
	 * Estimate token count for text
	 */
	private estimateTokens(text: string): number {
		// Rough estimation: 1 token ≈ 4 characters for English, 2 for Chinese
		const avgCharPerToken = text.match(/[\u4e00-\u9fa5]/) ? 2 : 4;
		return Math.ceil(text.length / avgCharPerToken);
	}
}
