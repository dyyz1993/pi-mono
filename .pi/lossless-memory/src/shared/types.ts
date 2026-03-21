/**
 * Lossless Memory - 共享类型定义
 * 
 * 这些类型由插件和 Dashboard 共享使用
 */

// ============================================================================
// 核心数据类型
// ============================================================================

/** DAG 节点层级 */
export type NodeLevel = 0 | 1 | 2 | 3 | 4;

/** 节点类型 */
export type NodeType = 'summary' | 'message';

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'toolResult';

/** DAG 节点接口 */
export interface MemoryNode {
  /** 唯一标识符 */
  id: string;
  /** 节点层级 (0=L0, 1=L1, 2=L2, 3=L3, 4=L4) */
  level: NodeLevel;
  /** 节点类型 */
  type: NodeType;
  /** 节点内容 */
  content: string;
  /** 父节点 ID 列表 */
  parentIds: string[];
  /** 子节点 ID 列表 */
  childIds: string[];
  /** 关联的会话 ID */
  sessionId: string;
  /** 关联的消息 ID 列表 */
  sessionEntryIds: string[];
  /** 创建时间戳 */
  createdAt: number;
  /** Token 数量 */
  tokenCount: number;
}

/** L0 原始消息 */
export interface L0Message extends MemoryNode {
  level: 0;
  role: MessageRole;
  type: 'message';
  timestamp: number;
}

/** L1+ 摘要节点 */
export interface SummaryNode extends MemoryNode {
  level: 1 | 2 | 3 | 4;
  type: 'summary';
}

// ============================================================================
// 会话和项目
// ============================================================================

/** 会话索引 */
export interface SessionIndex {
  /** 会话 ID */
  sessionId: string;
  /** 会话文件路径 */
  sessionPath: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后访问时间 */
  lastAccessed: number;
  /** 节点数量 */
  nodeCount: number;
  /** Token 总数 */
  totalTokens: number;
}

/** 项目信息 */
export interface Project {
  /** 项目路径 */
  path: string;
  /** 项目名称 */
  name: string;
  /** 会话数量 */
  sessionCount: number;
  /** 消息数量 */
  messageCount: number;
  /** 最后活跃时间 */
  lastActive: number;
}

// ============================================================================
// 搜索结果
// ============================================================================

/** 搜索结果项 */
export interface SearchResult {
  /** 匹配的节点 */
  node: MemoryNode;
  /** 相关性评分 */
  score: number;
  /** 匹配的关键词 */
  matchedKeywords: string[];
  /** 高亮片段 */
  snippet?: string;
}

/** 搜索请求 */
export interface SearchRequest {
  /** 搜索关键词 */
  query: string;
  /** 过滤条件 */
  filters?: {
    levels?: NodeLevel[];
    sessionIds?: string[];
    projectPaths?: string[];
    timeRange?: {
      from: number;
      to: number;
    };
  };
  /** 最大结果数 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}

/** 搜索响应 */
export interface SearchResponse {
  /** 搜索结果 */
  results: SearchResult[];
  /** 总结果数 */
  total: number;
  /** 搜索耗时 (ms) */
  took: number;
}

// ============================================================================
// 统计数据
// ============================================================================

/** 总体统计 */
export interface OverviewStats {
  /** 项目总数 */
  totalProjects: number;
  /** 会话总数 */
  totalSessions: number;
  /** 节点总数 */
  totalNodes: number;
  /** 消息总数 */
  totalMessages: number;
  /** Token 总数 */
  totalTokens: number;
}

/** API 使用统计 */
export interface UsageStats {
  /** 日期 */
  date: string;
  /** 服务类型 */
  service: 'embedding' | 'llm' | 'search';
  /** 调用次数 */
  calls: number;
  /** Token 消耗 */
  tokens: number;
  /** 费用 (USD) */
  cost: number;
}

/** 统计响应 */
export interface StatsResponse {
  /** 总体统计 */
  overview: OverviewStats;
  /** 使用统计 (最近 7 天) */
  usage: UsageStats[];
  /** 生成时间 */
  generatedAt: number;
}

// ============================================================================
// API 响应类型
// ============================================================================

/** 通用 API 响应 */
export interface ApiResponse<T> {
  /** 数据 */
  data: T;
  /** 错误信息 (如果有) */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  /** 数据 */
  data: T[];
  /** 总数 */
  total: number;
  /** 页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 */
  totalPages: number;
}
