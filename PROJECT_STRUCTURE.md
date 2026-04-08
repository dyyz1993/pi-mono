# Viking AI Coding Assistant - 项目结构

```
viking-ai-coding-assistant/
├── 📁 packages/
│   ├── 📁 backend/                 # Python FastAPI 后端
│   │   ├── 📁 src/
│   │   │   ├── 📁 api/            # API 端点
│   │   │   │   ├── chat.py        # 聊天接口
│   │   │   │   ├── sessions.py    # 会话管理
│   │   │   │   └── health.py      # 健康检查
│   │   │   ├── 📁 services/       # 业务逻辑
│   │   │   │   ├── ai_service.py  # AI 服务适配器
│   │   │   │   ├── mcp_service.py # MCP 工具管理
│   │   │   │   └── session_service.py # 会话管理
│   │   │   ├── 📁 models/         # 数据模型
│   │   │   │   ├── chat.py        # 聊天模型
│   │   │   │   └── session.py     # 会话模型
│   │   │   └── main.py            # 应用入口
│   │   ├── requirements.txt       # Python 依赖
│   │   ├── .env.example          # 环境变量示例
│   │   └── README.md             # 后端文档
│   │
│   └── 📁 web-ui/                 # React 前端
│       ├── 📁 src/
│       │   ├── 📁 components/     # React 组件
│       │   │   ├── ChatInterface.tsx    # 聊天界面
│       │   │   ├── CodeBlock.tsx        # 代码显示
│       │   │   ├── ConfigPanel.tsx      # 配置面板
│       │   │   └── Sidebar.tsx          # 侧边栏
│       │   ├── 📁 hooks/          # 自定义 Hooks
│       │   │   ├── useChat.ts     # 聊天逻辑
│       │   │   └── useConfig.ts   # 配置管理
│       │   ├── 📁 types/          # TypeScript 类型
│       │   │   └── index.ts       # 类型定义
│       │   ├── 📁 utils/          # 工具函数
│       │   │   └── api.ts         # API 客户端
│       │   ├── App.tsx           # 主应用
│       │   └── main.tsx          # 入口文件
│       ├── package.json          # npm 配置
│       ├── vite.config.ts        # Vite 配置
│       ├── tsconfig.json         # TypeScript 配置
│       └── README.md             # 前端文档
│
├── 📁 docs/                       # 项目文档
│   ├── api.md                    # API 文档
│   ├── frontend.md               # 前端文档
│   └── mcp-tools.md              # MCP 工具文档
│
├── 📁 tools/                      # 开发工具
│   ├── setup.sh                  # Linux/Mac 设置脚本
│   └── setup.ps1                 # Windows 设置脚本
│
├── package.json                   # Monorepo 根配置
├── pnpm-workspace.yaml          # pnpm workspace 配置
├── .gitignore                    # Git 忽略规则
├── README.md                     # 项目介绍
├── ARCHITECTURE.md               # 架构设计
├── QUICKSTART.md                 # 快速开始
├── DEVELOPMENT.md                # 开发指南
├── SUMMARY.md                    # 项目总结
└── PROJECT_STRUCTURE.md          # 本文件

```

## 核心文件说明

### 后端核心 (packages/backend/)

| 文件 | 用途 | 关键功能 |
|------|------|----------|
| `main.py` | 应用入口 | FastAPI 应用初始化、CORS、路由注册 |
| `ai_service.py` | AI 服务 | 多提供商适配、统一接口、错误处理 |
| `mcp_service.py` | MCP 服务 | 工具发现、执行、生命周期管理 |
| `chat.py` | 聊天接口 | 流式响应、会话管理、错误处理 |

### 前端核心 (packages/web-ui/)

| 文件 | 用途 | 关键功能 |
|------|------|----------|
| `App.tsx` | 主应用 | 布局、状态管理、全局配置 |
| `ChatInterface.tsx` | 聊天界面 | 消息显示、输入处理、滚动控制 |
| `useChat.ts` | 聊天 Hook | 流式接收、状态管理、错误处理 |
| `api.ts` | API 客户端 | HTTP 请求、错误处理、类型转换 |

### 配置文件

| 文件 | 用途 |
|------|------|
| `package.json` | Monorepo 根配置，工作空间脚本 |
| `pnpm-workspace.yaml` | pnpm 工作空间定义 |
| `requirements.txt` | Python 依赖管理 |
| `tsconfig.json` | TypeScript 编译选项 |
| `vite.config.ts` | Vite 构建配置 |

## 技术栈

### 后端
- **框架**: FastAPI (Python 3.11+)
- **AI SDK**: LangChain, OpenAI SDK, Anthropic SDK
- **工具**: MCP (Model Context Protocol)
- **其他**: Pydantic, Uvicorn, HTTPX

### 前端
- **框架**: React 18 + TypeScript
- **构建**: Vite
- **样式**: Tailwind CSS
- **状态**: React Hooks
- **代码高亮**: Prism.js / Highlight.js

### 开发工具
- **包管理**: pnpm
- **代码质量**: ESLint, Biome
- **测试**: Vitest, Pytest
- **类型检查**: TypeScript, MyPy

## 数据流

```
用户输入 → React 组件 → API Hook
    ↓
FastAPI 端点 → 会话服务 → AI 服务
    ↓
AI 提供商 (OpenAI/Anthropic/...)
    ↓
流式响应 → MCP 工具执行 (可选)
    ↓
Server-Sent Events → React Hook
    ↓
UI 更新
```

## 扩展点

1. **新增 AI 提供商**: 在 `backend/src/services/ai_service.py` 添加适配器
2. **新增 MCP 工具**: 在 `backend/src/services/mcp_service.py` 注册工具
3. **新增前端组件**: 在 `web-ui/src/components/` 创建组件
4. **新增 API 端点**: 在 `backend/src/api/` 创建路由模块

## 部署建议

### 开发环境
```bash
pnpm install
pnpm dev
```

### 生产环境
```bash
# 后端
cd packages/backend
pip install -r requirements.txt
uvicorn src.main:app --host 0.0.0.0 --port 8000

# 前端
cd packages/web-ui
pnpm build
# 使用 nginx 或其他静态服务器托管 dist/
```

### Docker 部署
建议创建 Dockerfile 和 docker-compose.yml（未来工作）

---

*最后更新: 2025-06-23*
