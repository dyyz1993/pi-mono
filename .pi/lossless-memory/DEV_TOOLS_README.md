# 🚀 智能开发工具套件

一套帮助你快速理解项目、推导开发链路、生成开发指引的工具，特别适合与 AI 协作开发。

## 📦 工具列表

### 1. 📊 项目上下文分析器

**命令**: `npm run dev:context`

**功能**:

- 扫描项目结构
- 分析模块依赖关系
- 生成项目上下文文件

**使用场景**:

- 开始新的 AI 会话时
- 了解项目整体结构
- 分析特定功能的依赖链

**示例**:

```bash
# 生成完整上下文
npm run dev:context

# 分析特定功能
npm run dev:context "订单管理"
```

**输出**:

- `.dev-context.md` - 完整上下文
- `.dev-context-compact.md` - 紧凑版本

---

### 2. 📖 开发指引生成器

**命令**: `npm run dev:guide "<任务描述>"`

**功能**:

- 根据任务描述生成详细开发步骤
- 提供代码示例和模板
- 列出常见错误和最佳实践

**支持的任务类型**:

- API 接口开发
- 前端页面开发
- 数据库设计
- WebSocket 功能
- SSE 推送功能

**示例**:

```bash
# API 开发
npm run dev:guide "我要开发一个订单管理接口"

# 前端开发
npm run dev:guide "我要开发一个用户列表页面"

# 数据库开发
npm run dev:guide "我要创建一个商品表"

# WebSocket 开发
npm run dev:guide "我要开发一个实时聊天功能"

# SSE 开发
npm run dev:guide "我要开发一个消息推送功能"
```

**输出**:

- `.dev-guide.md` - 详细开发指引

---

### 3. 🤖 AI 上下文生成器

**命令**: `npm run ai:context`

**功能**:

- 生成适合 AI 会话的上下文
- 自动复制到剪贴板（支持 macOS/Linux/Windows）
- 包含项目结构、规范、开发流程

**使用场景**:

- 开始新的 AI 会话
- 快速让 AI 了解项目
- 获取精准的开发帮助

**示例**:

```bash
# 生成并复制到剪贴板
npm run ai:context

# 仅生成，不复制
npm run ai:context -- --no-copy
```

**输出**:

- `.ai-context.md` - AI 会话上下文
- 自动复制到剪贴板

---

## 🎯 典型工作流

### 场景 1：开始新的 AI 会话

```bash
# 1. 生成 AI 上下文
npm run ai:context

# 2. 在 AI 会话中粘贴
# 上下文已自动复制到剪贴板，直接 Ctrl+V 粘贴

# 3. 描述你的需求
"我需要开发一个订单管理接口，请帮我实现。"
```

### 场景 2：开发新功能

```bash
# 1. 生成开发指引
npm run dev:guide "我要开发一个订单管理接口"

# 2. 查看指引
cat .dev-guide.md

# 3. 按步骤开发
# 每完成一步，勾选检查清单

# 4. 运行测试
npm test

# 5. 提交代码
git add .
git commit -m "feat: 添加订单管理接口"
```

### 场景 3：理解现有功能

```bash
# 1. 分析功能依赖
npm run dev:context "订单管理"

# 2. 查看依赖关系
cat .dev-context.md

# 3. 了解需要修改哪些文件
```

---

## 💡 与 AI 协作的最佳实践

### 1. 提供完整上下文

**❌ 不好的做法**:

```
用户: 帮我开发一个订单管理接口
AI: 好的，请问你的项目使用什么技术栈？
用户: React 和 Hono
AI: 请问你的数据库是什么？
用户: PostgreSQL
...（需要多次交互）
```

**✅ 好的做法**:

```bash
npm run ai:context
# 然后在 AI 会话中粘贴
```

```
用户: 我正在开发一个 React + Hono 项目。这是项目上下文：
[粘贴上下文]

我需要开发一个订单管理接口，包括：
- 创建订单
- 查询订单列表
- 查询订单详情
- 更新订单状态

AI: 好的，我了解了项目结构。根据你的需求，我将按照以下步骤实现：
1. 定义 Schema...
2. 创建数据库表...
3. 实现服务层...
...
```

### 2. 参考开发指引

让 AI 参考生成的开发指引：

```
用户: 请参考 .dev-guide.md 中的步骤和代码示例，帮我实现订单管理接口

AI: 好的，我将按照指引中的步骤实现：
[AI 会使用指引中的代码模板]
```

### 3. 逐步实现

按照指引的步骤逐一实现，不要跳步：

```bash
# Step 1: 定义 Schema
# Step 2: 创建数据库表
# Step 3: 实现服务层
# Step 4: 定义路由
# Step 5: 注册路由
# Step 6: 编写测试
```

---

## 📚 生成的文件说明

### `.dev-context.md`

完整的项目的上下文，包含：

- 模块列表和详细信息
- API 依赖关系
- 中间件列表
- 数据库表和迁移
- 开发规则文件

**用途**: 深入了解项目结构

### `.dev-context-compact.md`

紧凑版本的项目上下文，包含：

- 项目统计信息
- 模块列表
- 关键文件路径

**用途**: 快速了解项目概况

### `.dev-guide.md`

详细的开发指引，包含：

- 开发步骤
- 检查清单
- 代码示例
- 常见错误
- 测试指南
- 相关文档

**用途**: 按步骤开发新功能

### `.ai-context.md`

AI 会话专用上下文，包含：

- 项目信息
- 目录结构
- 项目统计
- 开发指引
- 开发规范
- 常用命令

**用途**: 在 AI 会话中快速建立项目认知

---

## 🔧 工具原理

### 依赖图构建

工具会扫描项目文件，构建依赖关系图：

1. 扫描 `src/server/module-*` 目录
2. 分析路由文件中的 API 定义
3. 分析服务文件中的数据库操作
4. 分析 Schema 文件中的类型定义
5. 构建完整的调用链

### 智能推导

根据任务描述，工具会：

1. 识别任务类型（API/前端/数据库/WebSocket/SSE）
2. 查找相关的现有模块
3. 推导需要的开发步骤
4. 生成对应的代码示例

### 规则匹配

工具会读取 `.claude/rules` 中的开发规范：

1. 匹配相关的规范文档
2. 提取关键的开发要求
3. 生成符合规范的代码示例

---

## 🎨 自定义扩展

### 添加新的任务类型

编辑 `lint-scripts/dev-guide-generator.ts`：

```typescript
private detectTaskType(description: string): string {
  const desc = description.toLowerCase()

  // 添加新的任务类型
  if (desc.includes('你的关键词')) {
    return 'your-task-type'
  }

  // ...
}

private generateYourTaskGuide(description: string): DevelopmentGuide {
  // 实现你的指引生成逻辑
}
```

### 扩展上下文分析

编辑 `lint-scripts/dev-context-analyzer.ts`：

```typescript
class ProjectAnalyzer {
  analyze(): ProjectContext {
    // 添加新的分析维度
    this.scanYourCustomDimension()

    return this.context
  }

  private scanYourCustomDimension(): void {
    // 实现你的分析逻辑
  }
}
```

---

## 📖 相关文档

- [使用指南](./DEV_CONTEXT_GUIDE.md) - 详细使用说明
- [项目架构](./DESIGN.md) - 架构设计文档
- [开发规范](./.claude/rules/) - 开发规范文档

---

## 🎉 总结

这套工具能够帮助你：

✅ **快速理解项目** - 自动扫描项目结构
✅ **推导开发链路** - 分析依赖关系
✅ **生成详细指引** - 提供步骤和代码示例
✅ **避免常见错误** - 列出注意事项
✅ **与 AI 高效协作** - 快速建立项目认知

---

## 🚀 快速开始

```bash
# 1. 生成 AI 上下文
npm run ai:context

# 2. 在 AI 会话中粘贴
# 上下文已自动复制到剪贴板

# 3. 描述你的需求
# AI 会根据上下文提供精准的帮助

# 4. 生成开发指引（可选）
npm run dev:guide "你的任务描述"

# 5. 按步骤开发
# 参考指引中的步骤和代码示例
```

开始使用吧！🎉
