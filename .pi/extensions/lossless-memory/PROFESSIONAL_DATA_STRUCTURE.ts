/**
 * Lossless Memory - 专业级数据结构定义
 * 
 * 展示完整的生产环境数据格式
 * 包含：类型定义、接口规范、数据示例
 */

// ============================================
// 1. 核心类型定义
// ============================================

/**
 * DAG 节点级别
 */
type NodeLevel = 0 | 1 | 2;

/**
 * 消息角色
 */
type MessageRole = 'user' | 'assistant';

/**
 * 基础节点接口
 */
interface BaseNode {
  /** 唯一标识符 (UUID 格式) */
  id: string;
  
  /** 节点层级 */
  level: NodeLevel;
  
  /** 节点类型 */
  type: 'summary' | 'message';
  
  /** 内容文本 */
  content: string;
  
  /** Token 数量 */
  tokenCount: number;
  
  /** 创建时间戳 */
  createdAt: number;
  
  /** 关键词索引 */
  keywords: string[];
}

/**
 * L2 高层摘要节点
 */
interface L2Node extends BaseNode {
  level: 2;
  
  /** 子节点 ID 列表 (L1 节点) */
  childIds: string[];
  
  /** 所有后代节点 ID (L1 + L0) */
  descendantIds: string[];
  
  /** 覆盖的主题列表 */
  topics: string[];
  
  /** 摘要生成模型 */
  summaryModel?: string;
  
  /** 最后更新时间 */
  updatedAt?: number;
}

/**
 * L1 基础摘要节点
 */
interface L1Node extends BaseNode {
  level: 1;
  
  /** 父节点 ID (L2 节点) */
  parentIds: string[];
  
  /** 兄弟节点 ID (其他 L1 节点) */
  siblingIds: string[];
  
  /** 子节点 ID 列表 (L0 消息) */
  childIds: string[];
  
  /** 主题分类 */
  topic: string;
  
  /** 摘要生成方式 */
  generationMethod?: 'llm' | 'extractive' | 'manual';
}

/**
 * L0 原始消息节点
 */
interface L0Message extends BaseNode {
  level: 0;
  
  /** 消息角色 */
  role: MessageRole;
  
  /** 父节点 ID (所属 L1 节点) */
  parentL1: string;
  
  /** L1 引用路径 */
  l1Path: string[];
  
  /** L2 引用路径 */
  l2Path: string[];
  
  /** 消息时间戳 */
  timestamp: number;
  
  /** 所属会话 ID */
  sessionId: string;
  
  /** 消息元数据 */
  metadata?: {
    model?: string;
    thinkingDuration?: number;
    tokenUsage?: {
      input: number;
      output: number;
    };
  };
}

// ============================================
// 2. 引用路径和查询接口
// ============================================

/**
 * 引用路径信息
 */
interface CitationPath {
  /** 直接父节点 ID */
  parentId: string;
  
  /** 完整路径 (从根到当前节点) */
  fullPath: string[];
  
  /** 兄弟节点 ID 列表 */
  siblingIds: string[];
  
  /** 子节点 ID 列表 */
  childIds: string[];
}

/**
 * 检索查询参数
 */
interface RetrievalQuery {
  /** 原始查询文本 */
  query: string;
  
  /** 扩展后的关键词 */
  keywords: string[];
  
  /** 主题过滤器 */
  topics?: string[];
  
  /** 时间范围过滤器 */
  timeRange?: {
    from: number;
    to: number;
  };
  
  /** 最大结果数 */
  limit?: number;
  
  /** 最低相关性分数 */
  minScore?: number;
}

/**
 * 检索结果
 */
interface RetrievalResult {
  /** L2 结果 */
  l2: L2Node[];
  
  /** L1 结果 */
  l1: Array<L1Node & {
    _score: number;
    _matchedKeywords: string[];
    _parent: string;
  }>;
  
  /** L0 结果 */
  l0: Array<L0Message & {
    _score: number;
    _matchedKeywords: string[];
    _parentL1: string;
    _parentL2: string;
  }>;
  
  /** 查询统计 */
  stats: {
    l2Count: number;
    l1Count: number;
    l0Count: number;
    searchTime: number;
  };
  
  /** 查询信息 */
  query: {
    original: string;
    expanded: string[];
  };
}

// ============================================
// 3. 专业数据示例
// ============================================

/**
 * 专业数据示例 - 模拟真实的 API 开发对话
 */
export const PROFESSIONAL_DATA_EXAMPLE = {
  // L2 高层摘要
  l2: {
    id: 'l2-20260321-001',
    level: 2 as const,
    type: 'summary' as const,
    content: '本次会话讨论了前端项目的技术选型和架构设计。主要决策包括：采用 React 18 + TypeScript 作为核心技术栈，使用 TailwindCSS 进行样式开发，通过 Vite 实现快速构建和开发服务器。项目结构遵循功能模块划分原则，计划实现用户管理、数据可视化、表单处理等核心功能。',
    tokenCount: 342,
    createdAt: 1774094400000,
    updatedAt: 1774098000000,
    childIds: [
      'l1-20260321-001',
      'l1-20260321-002',
      'l1-20260321-003',
      'l1-20260321-004'
    ],
    descendantIds: [
      'l1-20260321-001', 'l1-20260321-002', 'l1-20260321-003', 'l1-20260321-004',
      'msg-001', 'msg-002', 'msg-003', /* ... 32 条消息 */
    ],
    topics: [
      '技术选型',
      '项目架构',
      '开发工具',
      '代码规范'
    ],
    keywords: [
      'React', 'TypeScript', 'TailwindCSS', 'Vite',
      '前端', '架构', '技术栈', '开发环境'
    ],
    summaryModel: 'gpt-4o-mini'
  } as L2Node,
  
  // L1 基础摘要
  l1: [
    {
      id: 'l1-20260321-001',
      level: 1 as const,
      type: 'summary' as const,
      content: '技术栈讨论：确定使用 React 18 作为 UI 框架，配合 TypeScript 5.x 提供类型安全。选择了 Vite 5.0 作为构建工具，相比 Webpack 有更冷的启动速度和更快的 HMR。样式方案采用 TailwindCSS 3.4，通过实用类加速开发。',
      tokenCount: 156,
      createdAt: 1774094400000,
      parentIds: ['l2-20260321-001'],
      siblingIds: ['l1-20260321-002', 'l1-20260321-003', 'l1-20260321-004'],
      childIds: ['msg-001', 'msg-002', 'msg-003', 'msg-004', 'msg-005', 'msg-006', 'msg-007', 'msg-008'],
      topic: '技术选型',
      keywords: ['React', 'TypeScript', 'Vite', 'TailwindCSS', '技术栈'],
      generationMethod: 'llm'
    } as L1Node,
    
    {
      id: 'l1-20260321-002',
      level: 1 as const,
      type: 'summary' as const,
      content: '项目架构设计：采用功能模块划分，分为用户管理、数据可视化、表单处理三大模块。状态管理选用 Zustand，路由使用 React Router v6。API 层通过 TanStack Query 实现服务端状态管理和缓存。',
      tokenCount: 142,
      createdAt: 1774095000000,
      parentIds: ['l2-20260321-001'],
      siblingIds: ['l1-20260321-001', 'l1-20260321-003', 'l1-20260321-004'],
      childIds: ['msg-009', 'msg-010', 'msg-011', 'msg-012', 'msg-013', 'msg-014', 'msg-015', 'msg-016'],
      topic: '项目架构',
      keywords: ['架构', '模块划分', 'Zustand', 'React Router', 'TanStack Query'],
      generationMethod: 'llm'
    } as L1Node,
    
    {
      id: 'l1-20260321-003',
      level: 1 as const,
      type: 'summary' as const,
      content: '开发环境配置：Node.js 版本要求 18.18+，使用 pnpm 作为包管理器。ESLint + Prettier 保证代码质量，Husky + lint-staged 实现提交前检查。VSCode 推荐插件包括 ES7+ React snippets、TailwindCSS IntelliSense。',
      tokenCount: 138,
      createdAt: 1774095600000,
      parentIds: ['l2-20260321-001'],
      siblingIds: ['l1-20260321-001', 'l1-20260321-002', 'l1-20260321-004'],
      childIds: ['msg-017', 'msg-018', 'msg-019', 'msg-020', 'msg-021', 'msg-022', 'msg-023', 'msg-024'],
      topic: '开发工具',
      keywords: ['开发环境', 'Node.js', 'pnpm', 'ESLint', 'Prettier', 'VSCode'],
      generationMethod: 'llm'
    } as L1Node,
    
    {
      id: 'l1-20260321-004',
      level: 1 as const,
      type: 'summary' as const,
      content: '代码规范约定：组件采用函数式写法，使用 TypeScript 接口定义 Props。命名规范：组件 PascalCase，工具函数 camelCase，常量 UPPER_SNAKE_CASE。文件组织按功能模块而非文件类型。',
      tokenCount: 134,
      createdAt: 1774096200000,
      parentIds: ['l2-20260321-001'],
      siblingIds: ['l1-20260321-001', 'l1-20260321-002', 'l1-20260321-003'],
      childIds: ['msg-025', 'msg-026', 'msg-027', 'msg-028', 'msg-029', 'msg-030', 'msg-031', 'msg-032'],
      topic: '代码规范',
      keywords: ['代码规范', 'TypeScript', '命名规范', '组件规范', '文件组织'],
      generationMethod: 'llm'
    } as L1Node
  ],
  
  // L0 原始消息
  l0: [
    {
      id: 'msg-001',
      level: 0 as const,
      type: 'message' as const,
      role: 'user' as const,
      content: '我想开始一个新的前端项目，应该用什么技术栈比较好？当前是 2026 年，希望用比较新的技术。',
      tokenCount: 48,
      createdAt: 1774094400000,
      timestamp: 1774094400000,
      parentL1: 'l1-20260321-001',
      l1Path: ['l1-20260321-001'],
      l2Path: ['l2-20260321-001'],
      sessionId: 'session-20260321-001',
      keywords: ['前端', '技术栈', '2026']
    } as L0Message,
    
    {
      id: 'msg-002',
      level: 0 as const,
      type: 'message' as const,
      role: 'assistant' as const,
      content: '推荐 2026 年的主流前端技术栈：\n\n1. **框架**: React 18.x 或 Vue 3.4+\n2. **语言**: TypeScript 5.x (必选)\n3. **构建工具**: Vite 5.x (强烈推荐)\n4. **样式**: TailwindCSS 3.4+\n5. **状态管理**: Zustand (轻量) 或 Redux Toolkit\n\n这个组合开发体验好，社区活跃，性能优秀。',
      tokenCount: 112,
      createdAt: 1774094420000,
      timestamp: 1774094420000,
      parentL1: 'l1-20260321-001',
      l1Path: ['l1-20260321-001'],
      l2Path: ['l2-20260321-001'],
      sessionId: 'session-20260321-001',
      metadata: {
        model: 'gpt-4o-mini',
        thinkingDuration: 1200,
        tokenUsage: {
          input: 85,
          output: 112
        }
      },
      keywords: ['React', 'Vue', 'TypeScript', 'Vite', 'TailwindCSS', 'Zustand']
    } as L0Message,
    
    {
      id: 'msg-003',
      level: 0 as const,
      type: 'message' as const,
      role: 'user' as const,
      content: '为什么推荐 Vite 而不是 Webpack？',
      tokenCount: 18,
      createdAt: 1774094440000,
      timestamp: 1774094440000,
      parentL1: 'l1-20260321-001',
      l1Path: ['l1-20260321-001'],
      l2Path: ['l2-20260321-001'],
      sessionId: 'session-20260321-001',
      keywords: ['Vite', 'Webpack', '构建工具']
    } as L0Message,
    
    {
      id: 'msg-004',
      level: 0 as const,
      type: 'message' as const,
      role: 'assistant' as const,
      content: 'Vite 相比 Webpack 的优势：\n\n1. **冷启动快**: 基于 ES Modules，无需打包即可启动，大型项目也能秒开\n2. **HMR 更快**: 修改文件只更新变更模块，不刷新页面\n3. **配置简单**: 开箱即用，配置量远少于 Webpack\n4. **Rollup 打包**: 生产环境使用 Rollup，打包质量优秀\n5. **插件生态**: 兼容 Rollup 插件，生态丰富\n\n2026 年的今天，Vite 已成为前端构建工具的事实标准。',
      tokenCount: 156,
      createdAt: 1774094460000,
      timestamp: 1774094460000,
      parentL1: 'l1-20260321-001',
      l1Path: ['l1-20260321-001'],
      l2Path: ['l2-20260321-001'],
      sessionId: 'session-20260321-001',
      metadata: {
        model: 'gpt-4o-mini',
        thinkingDuration: 800,
        tokenUsage: {
          input: 42,
          output: 156
        }
      },
      keywords: ['Vite', 'Webpack', 'HMR', 'ES Modules', 'Rollup']
    } as L0Message
  ]
};

// ============================================
// 4. 数据结构说明
// ============================================

/**
 * 数据结构说明文档
 * 
 * ## 层级关系
 * 
 * L2 (高层摘要)
 * └─ childIds → [L1 节点数组]
 *     ├─ childIds → [L0 消息数组]
 *     └─ siblingIds → [其他 L1 节点]
 * 
 * ## 引用路径
 * 
 * 每个 L0 消息都包含:
 * - parentL1: 直接父节点 ID
 * - l1Path: 完整的 L1 引用路径
 * - l2Path: 完整的 L2 引用路径
 * 
 * 这使得可以从任意节点向上追溯到根节点。
 * 
 * ## 查询索引
 * 
 * 每个节点都包含 keywords 数组，用于:
 * 1. 关键词匹配搜索
 * 2. 相关性评分计算
 * 3. 主题分类过滤
 * 
 * ## 元数据
 * 
 * L0 消息可包含 metadata 字段:
 * - model: 生成该消息的 LLM 模型
 * - thinkingDuration: 思考耗时 (ms)
 * - tokenUsage: token 使用情况
 * 
 * 这些信息有助于分析和优化。
 */

