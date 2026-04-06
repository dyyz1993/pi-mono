# 自定义消息组件指南

本指南展示如何在 `@mariozechner/pi-web-ui` 中创建和使用自定义消息组件。

## 概述

Pi Web UI 支持自定义消息类型和渲染器，允许你创建专门的消息组件来展示特定类型的内容，如通知、数据卡片、嵌入链接等。

## 核心概念

### 1. 消息类型定义

自定义消息是一个包含 `type` 字段的对象，用于标识消息类型：

```typescript
interface MyCustomMessage {
  role: MessageRole;  // "user" | "assistant" | "user-with-attachments"
  type: "my-custom-type";  // 自定义类型标识符
  // ... 其他自定义字段
}
```

### 2. 消息渲染器 (MessageRenderer)

渲染器负责判断和渲染自定义消息：

```typescript
interface MessageRenderer {
  canRender: (message: any) => boolean;  // 判断是否可以渲染此消息
  render: (message: any) => HTMLElement;  // 渲染消息为 DOM 元素
}
```

### 3. 注册渲染器

使用 `registerMessageRenderer()` 注册自定义渲染器：

```typescript
import { registerMessageRenderer } from "@mariozechner/pi-web-ui";

registerMessageRenderer(myCustomRenderer);
```

## 示例文件

本目录包含三个示例文件：

### 1. `custom-notification-message.ts`
**通知消息组件** - 展示基础的自定义消息实现
- 支持 info/warning/error/success 四种级别
- 带图标和时间戳
- 动画效果

**使用方式：**
```typescript
import { 
  registerNotificationMessageRenderer, 
  createNotification 
} from './custom-notification-message.js';

// 注册渲染器
registerNotificationMessageRenderer();

// 创建并发送通知
const notification = createNotification(
  "操作成功",
  "文件已保存",
  "success"
);
agent.sendMessage(notification);
```

### 2. `custom-data-card.ts`
**数据卡片组件** - 展示交互式自定义消息
- 渐变背景设计
- 支持多种数据类型（货币、百分比、日期等）
- 可交互的按钮
- 可展开的元数据

**使用方式：**
```typescript
import { 
  registerDataCardMessageRenderer, 
  createDataCard 
} from './custom-data-card.js';

// 注册渲染器
registerDataCardMessageRenderer();

// 创建数据卡片
const card = createDataCard(
  "销售概览",
  [
    { label: "收入", value: 125000, type: "currency" },
    { label: "转化率", value: 23.5, type: "percentage" },
  ],
  {
    description: "2024 Q1 数据",
    actions: [
      { label: "查看详情", action: "view-details", variant: "primary" }
    ],
    metadata: { reportId: "sales-q1" }
  }
);
agent.sendMessage(card);

// 监听卡片动作
document.addEventListener('card-action', (e) => {
  console.log('Action:', e.detail.action);
  console.log('Metadata:', e.detail.metadata);
});
```

### 3. `custom-messages-usage.ts`
**完整使用示例** - 展示如何在真实应用中集成
- 创建返回自定义消息的工具
- 在 Agent 中使用自定义消息
- 监听和处理自定义事件

## 完整集成步骤

### 步骤 1: 创建自定义消息类型和组件

```typescript
// my-message.ts
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { css } from "lit";
import type { MessageRenderer, MessageRole } from "@mariozechner/pi-web-ui";

// 1. 定义消息类型
export interface MyMessage {
  role: MessageRole;
  type: "my-message";
  content: string;
  // ... 其他字段
}

// 2. 创建组件
@customElement("my-message")
export class MyMessageComponent extends LitElement {
  static override styles = css`
    :host { display: block; }
    /* 样式... */
  `;

  @property({ type: Object }) declare data: MyMessage;

  override render() {
    return html`<div>${this.data.content}</div>`;
  }
}

// 3. 创建渲染器
export const myMessageRenderer: MessageRenderer = {
  canRender: (message: any) => message?.type === "my-message",
  render: (message: MyMessage) => {
    const element = document.createElement("my-message");
    (element as MyMessageComponent).data = message;
    return element;
  }
};

// 4. 创建消息工厂函数
export function createMyMessage(content: string): MyMessage {
  return {
    role: "assistant",
    type: "my-message",
    content,
  };
}

// 5. 导出注册函数
export function registerMyMessageRenderer() {
  registerMessageRenderer(myMessageRenderer);
}
```

### 步骤 2: 在应用中注册

```typescript
// main.ts
import { registerMyMessageRenderer } from './my-message.js';

// 在应用启动时注册
registerMyMessageRenderer();
```

### 步骤 3: 在工具中使用

```typescript
import { createTool } from "@mariozechner/pi-agent-core";
import { z } from "zod";
import { createMyMessage } from './my-message.js';

export const myTool = createTool({
  name: "my_tool",
  description: "返回自定义消息的工具",
  parameters: z.object({
    content: z.string(),
  }),
  execute: async (params) => {
    return createMyMessage(params.content);
  },
});
```

### 步骤 4: 添加到 Agent

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { myTool } from './my-tool.js';

const agent = new Agent({
  tools: [myTool],
  // ... 其他配置
});
```

## 最佳实践

### 1. 消息可序列化
确保自定义消息是纯数据对象，可以 JSON 序列化：

```typescript
// ✅ 好 - 纯数据
const message = {
  type: "notification",
  title: "成功",
  data: { count: 42 }
};

// ❌ 坏 - 包含函数
const message = {
  type: "notification",
  onClick: () => {} // 不可序列化
};
```

### 2. 使用 CustomEvent 通信
组件通过事件与外部通信，而不是直接调用：

```typescript
// 在组件中
this.dispatchEvent(new CustomEvent('my-action', {
  detail: { id: 123 },
  bubbles: true,
  composed: true,
}));

// 在应用中监听
document.addEventListener('my-action', (e) => {
  console.log('Action:', e.detail.id);
});
```

### 3. 提供元数据
使用 metadata 字段传递额外信息：

```typescript
const card = createDataCard(title, items, {
  metadata: {
    source: "api",
    timestamp: Date.now(),
    // 用于事件处理
  }
});
```

### 4. 样式一致性
使用 CSS 变量保持与主题一致：

```typescript
static override styles = css`
  .card {
    background: var(--card-bg, #fff);
    color: var(--text-color, #000);
  }
`;
```

### 5. 渐进增强
确保消息在不支持自定义渲染时也能显示：

```typescript
canRender: (message: any) => {
  // 检查所有必需字段
  return message?.type === "my-message" && 
         message?.content !== undefined;
}
```

## 调试技巧

### 检查渲染器是否注册

```typescript
import { getMessageRenderer } from "@mariozechner/pi-web-ui";

const renderer = getMessageRenderer(myMessage);
console.log('Renderer:', renderer); // 应该显示你的渲染器
```

### 查看消息流

```typescript
agent.subscribe((state) => {
  console.log('Messages:', state.messages);
});
```

### 组件内部日志

```typescript
override render() {
  console.log('Rendering with data:', this.data);
  return html`...`;
}
```

## 相关 API

- `registerMessageRenderer(renderer: MessageRenderer)` - 注册渲染器
- `getMessageRenderer(message: any)` - 获取消息的渲染器
- `renderMessage(message: any)` - 渲染消息
- `MessageRole` - 消息角色类型
- `MessageRenderer` - 渲染器接口

## 更多资源

- [Lit 官方文档](https://lit.dev/)
- [mini-lit 组件库](../README.md)
- [Pi Agent 核心](../../pi-agent-core/README.md)

## 问题排查

### Q: 自定义消息不显示？
A: 检查：
1. 是否调用了 `registerMessageRenderer()`
2. `canRender()` 是否返回 `true`
3. `render()` 是否返回有效的 DOM 元素
4. 是否有 CSS 样式冲突

### Q: 事件监听不到？
A: 确保事件设置了 `bubbles: true` 和 `composed: true`

### Q: 样式不生效？
A: Lit 组件的样式默认是 Shadow DOM 隔离的，使用 `:host` 选择器

### Q: 消息状态如何持久化？
A: 自定义消息会自动保存到会话存储中，恢复时会重新渲染
