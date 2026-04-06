完成！我已经为你创建了一个完整的自定义消息组件示例。让我总结一下创建的文件：

## 📁 创建的文件

### 1. **`custom-notification-message.ts`** (5.6 KB)
一个通知消息组件示例，展示了基础的自定义消息实现：
- ✅ 支持 4 种级别：info/warning/error/success
- ✅ 带图标和时间戳
- ✅ 动画效果（滑入动画）
- ✅ 完整的类型定义和工厂函数

### 2. **`custom-data-card.ts`** (8.4 KB)
一个数据卡片组件，展示交互式自定义消息：
- ✅ 渐变背景设计
- ✅ 支持多种数据类型（货币、百分比、日期等）
- ✅ 可交互的操作按钮
- ✅ 可展开的元数据显示
- ✅ 使用 CustomEvent 与外部通信

### 3. **`custom-messages-usage.ts`** (6.5 KB)
完整的使用示例，展示如何在实际应用中集成：
- ✅ 创建返回自定义消息的 Agent 工具
- ✅ 在 Agent 中使用自定义消息
- ✅ 监听和处理自定义事件
- ✅ 包含一个额外的 Embed 消息示例

### 4. **`CUSTOM_MESSAGES_GUIDE.md`** (6.3 KB)
详细的开发指南文档，包含：
- ✅ 核心概念说明
- ✅ 完整集成步骤
- ✅ 最佳实践
- ✅ 调试技巧
- ✅ 常见问题解答

## 🎯 核心要点

### 使用步骤：

1. **定义消息类型**（TypeScript 接口）
2. **创建 Lit 组件**（渲染逻辑）
3. **实现 MessageRenderer**（判断和渲染）
4. **注册渲染器**（`registerMessageRenderer()`）
5. **创建消息工厂函数**（`createXxxMessage()`）
6. **在工具中使用**（Agent tool 返回自定义消息）

### 关键特性：

- ✨ **完全类型安全** - TypeScript 类型定义
- 🎨 **样式隔离** - Lit Shadow DOM
- 🔄 **事件驱动** - CustomEvent 通信
- 📦 **可序列化** - 纯数据对象
- 🚀 **易于扩展** - 模块化设计

## 📝 使用示例

```typescript
// 1. 注册渲染器
import { registerNotificationMessageRenderer } from './custom-notification-message.js';
registerNotificationMessageRenderer();

// 2. 创建消息
import { createNotification } from './custom-notification-message.js';
const notification = createNotification("任务完成", "文件已导出", "success");

// 3. 发送到 Agent
agent.sendMessage(notification);
```

这些示例完全遵循项目的架构风格（TypeScript + Lit + mini-lit），并且可以直接在你的 Pi Web UI 项目中使用！