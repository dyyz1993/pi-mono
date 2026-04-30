# linked-projects-bridge 插件

## 功能说明

实现跨项目知识桥接，解决项目 A 依赖项目 B 但文档不足导致的认知断层问题。

### 核心能力

1. **配置关联的外部项目**：在项目根目录的 `.pi/linked-projects.json` 配置多个关联项目
2. **工具拦截**：拦截访问关联项目路径的工具调用，引导使用子任务查找
3. **知识沉淀**：子任务查找结果自动写入项目级知识文件和个人级 agent memories
4. **系统提示词注入**：自动将关联项目信息和已有知识注入到 LLM 提示词中

---

## Channel 协议设计（ServerChannel）

本插件使用 `ServerChannel<T>` 类型安全的双向通信机制，区分调用（call）和推送（emit）职责。

### Contract 定义

```typescript
interface LinkedProjectsChannelContract {
	methods: {
		// 获取所有项目列表
		config_list: {
			params: { readonly?: boolean };
			return: { projects: LinkedProject[] };
		};

		// 获取单个项目详情
		config_get: {
			params: { projectId: string };
			return: { project: LinkedProject | null };
		};

		// 添加新项目
		config_add: {
			params: { project: LinkedProject };
			return: { success: boolean };
		};

		// 更新项目配置
		config_update: {
			params: { projectId: string; project: Partial<LinkedProject> };
			return: { success: boolean };
		};

		// 删除项目
		config_delete: {
			params: { projectId: string };
			return: { success: boolean };
		};
	};

	events: {
		// 配置变更时推送（服务器主动推送）
		config_changed: { projects: LinkedProject[] };

		// 知识更新时推送（服务器主动推送）
		knowledge_changed: { projectId: string };
	};
}
```

### 消息格式

#### 调用消息（右侧面板 → 插件）

右侧面板作为**调用方（Client）**，通过 `channel.call()` 调用插件提供的方法：

```typescript
// 获取项目列表（初始化时调用）
const result = await channel.call("config_list", {});
// → { projects: [...] }

// 添加项目
const result = await channel.call("config_add", { project: { id: "my-lib", path: "/path", ... } });
// → { success: true }

// 获取单个项目
const result = await channel.call("config_get", { projectId: "my-lib" });
// → { project: { ... } | null }

// 更新项目
const result = await channel.call("config_update", { projectId: "my-lib", project: { readonly: true } });
// → { success: true }

// 删除项目
const result = await channel.call("config_delete", { projectId: "my-lib" });
// → { success: true }
```

#### 推送消息（插件 → 右侧面板）

插件作为**服务方（Server）**，主动推送事件到右侧面板：

```typescript
// 推送配置变更（添加/更新/删除项目后）
channel.emit("config_changed", { projects: config.projects });

// 推送知识更新（知识沉淀后）
channel.emit("knowledge_changed", { projectId: "my-lib" });
```

#### 事件消息（右侧面板 → 插件）

右侧面板可以监听这些事件：

```typescript
channel.onReceive((data) => {
	if (data.type === "config_changed") {
		console.log("Projects updated:", data.projects);
	} else if (data.type === "knowledge_changed") {
		console.log("Knowledge updated for project:", data.projectId);
	}
});
```

---

## 生命周期说明

### 初始化流程

```
1. 插件加载
   ├─ 读取 .pi/linked-projects.json
   ├─ 读取 .pi/linked-knowledge/*.md
   ├─ 在 before_agent_start 中注入系统提示词
   └─ 注册 Channel "linked-projects"

2. 右侧面板初始化
   ├─ 调用 channel.call("config_list", {})
   ├─ 获取完整项目列表
   ├─ 渲染配置 UI
   └─ 订阅 channel.onReceive 监听后续事件

3. 配置变更推送（双向）
   用户在右侧面板操作：
   ├─ 调用 channel.call("config_add/update/delete", { ... })
   ├─ 插件保存配置到文件
   ├─ 插件推送 channel.emit("config_changed")
   └─ 右侧面板收到事件后更新 UI

4. 知识更新推送
   ├─ 子任务查找完成
   ├─ 插件沉淀知识到文件 + agent memories
   ├─ 插件推送 channel.emit("knowledge_changed")
   └─ 右侧面板收到后刷新知识展示

5. 持续变化通知
   ├─ 右侧面板可以随时拉取最新状态
   ├─ 配置变化 → 插件推送 config_changed
   └─ 知识变化 → 插件推送 knowledge_changed
```

---

## 使用示例

### 右侧面板（Client 端）

```typescript
import { RpcClient } from "@dyyz1993/pi-coding-agent";

async function initLinkedProjectsPanel(client: RpcClient) {
	const channel = client.channel("linked-projects");

	await client.start();

	channel.onReceive((data) => {
		if (data.type === "config_changed") {
			updateProjectsUI(data.projects);
		} else if (data.type === "knowledge_changed") {
			refreshKnowledgeDisplay(data.projectId);
		}
	});

	const result = await channel.call("config_list", {});
	if (result.projects) {
		updateProjectsUI(result.projects);
	}
}

function updateProjectsUI(projects: LinkedProject[]) {
	console.log("Projects:", projects);
}

function refreshKnowledgeDisplay(projectId: string) {
	console.log("Refreshing knowledge for:", projectId);
}
```

---

## 数据持久化

### 配置文件

路径：项目根目录 `.pi/linked-projects.json`

```json
{
  "projects": [
    {
      "id": "pi-mono",
      "path": "/Users/dev/pi-mono",
      "description": "pi coding agent 主仓库",
      "relationship": "upstream",
      "keyPaths": [
        { "path": "packages/coding-agent/src/core/extensions/", "description": "扩展 API" },
        { "path": "packages/coding-agent/src/core/tools/", "description": "工具定义" }
      ],
      "readonly": true
    }
  ]
}
```

### 知识沉淀文件

路径：`.pi/linked-knowledge/<project-id>.md`

```markdown
# pi-mono 知识沉淀

## 2026-04-30: Extension API 概览
- Extension 通过 `pi.on("tool_call", handler)` 注册工具调用拦截
- `before_agent_start` 事件可注入/替换系统提示词
- Channel 机制支持插件与 UI 双向通信
- 子任务通过 spawn 独立 pi 进程实现

## 2026-04-30: 工具拦截机制
- 三层拦截: Agent Core hooks → Extension events → Hooks system
- `beforeToolCall` 返回 `{ block: true }` 可阻止执行
- bash 工具具有 `spawnHook` 可感知/修改 cwd

## 2026-05-01: 文件快照机制发现
- 项目支持增量快照，每次 tool 执行后自动记录文件状态变化
- 通过 `navigateTree` 支持快速回滚到任意历史节点
- 快照数据存储在项目级文件系统，支持跨会话持久化
```

---

## 配置说明

### 字段说明

- **id**: 项目唯一标识符，用于知识文件命名和引用
- **path**: 关联项目的绝对路径
- **description**: 项目关系说明，注入到系统提示词
- **relationship**: `upstream`（上游依赖）/ `downstream`（下游消费者）/ `sibling`（同级关联）
- **keyPaths**: 关键目录/文件及说明，帮助子任务缩小搜索范围。目录优先，偶尔可以指定关键文件
- **readonly**: 默认 true，子任务只有读权限

### 操作权限

- **readonly = true**: 子任务只能查询，不能修改（通过 UI 也不能修改）
- **readonly = false** 或未设置: 允许修改（需要权限检查）

---

## 与子任务集成

当 LLM 查看关联项目代码时，插件会拦截工具调用并引导使用子任务。

### 拦截提示

```
该路径属于关联项目「pi-mono (upstream)」。
请启动子任务(Task)查找，建议 prompt：

---
在项目 /Users/dev/pi-mono 中查找以下信息：
[用户的原始意图]
重点关注目录：
- packages/coding-agent/src/core/extensions/ — 扩展 API
- packages/coding-agent/src/core/tools/ — 工具定义

已有知识参考：.pi/linked-knowledge/pi-mono.md
请总结关键发现。
---
```

### 子任务环境

子任务会以关联项目的路径为 `cwd` 启动，因此：
- 子任务可以自由访问关联项目的所有文件
- 子任务不受主任务的拦截规则影响
- 子任务返回的结构化结果会被插件沉淀为知识

---

## 文件结构

```
examples/extensions/linked-projects-bridge/
├── index.ts           # 插件入口，注册所有事件和 Channel
├── config.ts          # 配置文件读写（.pi/linked-projects.json）
├── interceptor.ts     # 工具调用拦截逻辑
├── knowledge.ts        # 知识文件管理（.pi/linked-knowledge/*.md）
└── README.md          # 本文档
```

---

## 技术细节

### ServerChannel 使用优势

- **类型安全**：通过 Contract 接口完全定义方法签名和返回类型
- **自动 invokeId**：插件调用 `channel.handle()` 注册的方法时自动生成 invokeId，调用方通过 `channel.invoke()` 自动附加
- **错误处理**：方法执行出错时自动 reject Promise，调用方可以捕获错误
- **消息隔离**：调用消息（`__call`）和推送消息（`emit`）完全分离，不会混淆

### 拦截机制

插件监听 `tool_call` 事件，当检测到访问关联项目路径时：
- 返回 `{ block: true }` 阻止工具执行
- 返回引导消息，建议 LLM 使用子任务

### 知识管理

- **项目级**：存储在 `.pi/linked-knowledge/<project-id>.md`，团队共享
- **个人级**：通过 agent memories 持久化，跨项目个人知识积累
- **自动追加**：每次子任务完成后追加最新发现到知识文件

---

## 开发和测试

### 开发插件

插件位于 `packages/coding-agent/examples/extensions/linked-projects-bridge/`

### 运行测试

```bash
cd packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/suite/linked-projects-bridge.test.ts
```

### 测试覆盖

- ✅ 配置文件读写（loadConfig, saveConfig）
- ✅ 知识文件管理（appendKnowledge, KnowledgeStore）
- ✅ 路径匹配（matchLinkedPath）
- ✅ 系统提示词构建（buildSystemPromptSection）
- ✅ 拦截消息构建（buildInterceptMessage）

---

## 注意事项

1. **首次使用**：首次使用时需要创建 `.pi/linked-projects.json` 配置文件
2. **路径权限**：确保关联项目路径可读（子任务会以该路径为 cwd 启动）
3. **知识复用**：系统提示词中会包含已有知识摘要，LLM 可能直接复用，减少子任务调用
4. **配置热重载**：插件监听配置文件变化，支持外部工具修改配置后自动重载（通过 watchFile 实现）
