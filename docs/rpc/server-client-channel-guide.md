# ServerChannel 和 ClientChannel 类型化 RPC 指南

本文档描述 `ServerChannel` 和 `ClientChannel` 类型化 RPC 模式的使用方法。

## 概述

`ServerChannel` 和 `ClientChannel` 是一对类型化的 channel wrapper，用于在客户端和服务端之间进行安全的类型化 RPC 通信。

| 组件 | 用途 | 主要方法 |
|------|------|----------|
| `ServerChannel<T>` | 服务端使用，定义方法和发送事件 | `handle()`, `emit()` |
| `ClientChannel<T>` | 客户端使用，调用方法和订阅事件 | `call()`, `on()` |

## 定义 Channel Contract

首先定义一个继承自 `ChannelContract` 的接口：

```typescript
import type { ChannelContract } from "@dyyz1993/pi-coding-agent";

interface MyChannel extends ChannelContract {
  methods: {
    getUser: { params: { id: string }; return: { name: string; email: string } };
    updateUser: { params: { id: string; name: string }; return: { success: boolean } };
  };
  events: {
    userUpdated: { userId: string; name: string };
    userDeleted: { userId: string };
  };
}
```

## 服务端使用

### 创建 ServerChannel

```typescript
import { ServerChannel } from "@dyyz1993/pi-coding-agent";

// 假设你有一个扩展，通过 ctx 获取 channel
export function createMyExtension(ctx: ExtensionContext) {
  const channel = ctx.channel("my-channel");
  const server = new ServerChannel<MyChannel>(channel);

  // 注册方法处理程序
  server.handle("getUser", async ({ id }) => {
    // 从数据库获取用户
    const user = await db.getUserById(id);
    return { name: user.name, email: user.email };
  });

  server.handle("updateUser", async ({ id, name }) => {
    await db.updateUserName(id, name);
    return { success: true };
  });

  // 发送事件
  server.emit("userUpdated", { userId: "123", name: "Alice" });
}
```

### handle() 方法

```typescript
handle<K extends MethodKeys<T>>(
  method: K,
  fn: (params: MethodParams<T, K>) => MethodReturn<T, K>
): void
```

- `method`: 要处理的方法名称
- `fn`: 处理函数，接收类型化的参数，返回类型化的结果

### emit() 方法

```typescript
emit<K extends EventKeys<T>>(event: K, data: EventData<T, K>): void
```

- `event`: 事件名称
- `data`: 事件数据

## 客户端使用

### 创建 ClientChannel

```typescript
import { RpcClient } from "@dyyz1993/pi-coding-agent/modes/rpc/rpc-client";
import { ClientChannel } from "@dyyz1993/pi-coding-agent";

const client = new RpcClient({ /* options */ });
await client.start();

// 获取原始 channel 并包装为 ClientChannel
const rawChannel = client.channel("my-channel");
const typedClient = new ClientChannel<MyChannel>(rawChannel);

// 调用方法
const user = await typedClient.call("getUser", { id: "123" });
console.log(user.name); // 类型安全！

const result = await typedClient.call("updateUser", { id: "123", name: "Bob" });
console.log(result.success); // true

// 订阅事件
const unsub = typedClient.on("userUpdated", (data) => {
  console.log(`User ${data.userId} updated to ${data.name}`);
});

// 取消订阅
unsub();
```

### call() 方法

```typescript
call<K extends MethodKeys<T>>(
  method: K,
  params: MethodParams<T, K>,
  timeoutMs?: number
): Promise<MethodReturn<T, K>>
```

- `method`: 要调用的方法名称
- `params`: 类型化的参数
- `timeoutMs`: 可选超时时间（默认 30000ms）

### on() 方法

```typescript
on<K extends EventKeys<T>>(
  event: K,
  handler: (data: EventData<T, K>) => void
): () => void
```

- `event`: 要监听的事件名称
- `handler`: 事件处理函数
- **返回值**: 取消订阅的函数

## 完整示例

### 服务端扩展

```typescript
import type { Extension, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import { ServerChannel } from "@dyyz1993/pi-coding-agent";

interface TodoChannel extends ChannelContract {
  methods: {
    getTodos: { params: {}; return: { todos: Array<{ id: string; text: string; done: boolean }> } };
    addTodo: { params: { text: string }; return: { id: string } };
    toggleTodo: { params: { id: string }; return: { done: boolean } };
    deleteTodo: { params: { id: string }; return: { success: boolean } };
  };
  events: {
    todoAdded: { id: string; text: string };
    todoToggled: { id: string; done: boolean };
    todoDeleted: { id: string };
  };
}

export const todoExtension: Extension = {
  name: "todo",
  description: "Todo list management via typed RPC",

  setup(ctx) {
    const channel = ctx.channel("todo");
    const server = new ServerChannel<TodoChannel>(channel);

    const todos = new Map<string, { text: string; done: boolean }>();

    server.handle("getTodos", () => {
      return {
        todos: Array.from(todos.entries()).map(([id, todo]) => ({
          id,
          ...todo,
        })),
      };
    });

    server.handle("addTodo", ({ text }) => {
      const id = Date.now().toString();
      todos.set(id, { text, done: false });
      server.emit("todoAdded", { id, text });
      return { id };
    });

    server.handle("toggleTodo", ({ id }) => {
      const todo = todos.get(id);
      if (!todo) throw new Error(`Todo ${id} not found`);

      todo.done = !todo.done;
      server.emit("todoToggled", { id, done: todo.done });
      return { done: todo.done };
    });

    server.handle("deleteTodo", ({ id }) => {
      if (!todos.has(id)) throw new Error(`Todo ${id} not found`);

      todos.delete(id);
      server.emit("todoDeleted", { id });
      return { success: true };
    });
  },
};
```

### 客户端使用

```typescript
import { RpcClient } from "@dyyz1993/pi-coding-agent/modes/rpc/rpc-client";
import { ClientChannel } from "@dyyz1993/pi-coding-agent";

const client = new RpcClient();
await client.start();

const todoClient = new ClientChannel<TodoChannel>(client.channel("todo"));

// 获取所有 todos
const { todos } = await todoClient.call("getTodos", {});
console.log("Current todos:", todos);

// 添加 todo
const { id } = await todoClient.call("addTodo", { text: "Buy groceries" });
console.log("Added todo:", id);

// 切换 todo 状态
const { done } = await todoClient.call("toggleTodo", { id });
console.log("Todo is now:", done ? "done" : "not done");

// 订阅事件
todoClient.on("todoAdded", (event) => {
  console.log(`New todo added: ${event.id} - ${event.text}`);
});

todoClient.on("todoToggled", (event) => {
  console.log(`Todo ${event.id} is now: ${event.done ? "done" : "not done"}`);
});

todoClient.on("todoDeleted", (event) => {
  console.log(`Todo deleted: ${event.id}`);
});

await client.stop();
```

## 类型安全优势

使用 `ServerChannel` 和 `ClientChannel` 的主要优势是完整的类型安全：

### 编译时类型检查

```typescript
// ✅ 正确 - 类型匹配
await client.call("getUser", { id: "123" });

// ❌ 错误 - 缺少必需参数
await client.call("getUser", {}); // TypeScript error: Property 'id' is missing

// ❌ 错误 - 参数类型错误
await client.call("getUser", { id: 123 }); // TypeScript error: Type 'number' is not assignable to type 'string'

// ❌ 错误 - 方法不存在
await client.call("unknownMethod", {}); // TypeScript error: Argument of type '"unknownMethod"' is not assignable...

// ✅ 正确 - 返回值有正确的类型
const result = await client.call("getUser", { id: "123" });
console.log(result.name); // TypeScript knows result.name is a string
console.log(result.email); // TypeScript knows result.email is a string

// ❌ 错误 - 访问不存在的属性
console.log(result.unknown); // TypeScript error: Property 'unknown' does not exist...
```

### 事件类型安全

```typescript
// ✅ 正确 - 事件数据类型匹配
client.on("userUpdated", (data) => {
  console.log(data.userId); // string
  console.log(data.name); // string
});

// ❌ 错误 - 事件不存在
client.on("unknownEvent", (data) => { // TypeScript error: Argument of type '"unknownEvent"'...
  console.log(data);
});

// ✅ 正确 - 多个事件监听器
const unsub1 = client.on("userUpdated", (data) => { /* ... */ });
const unsub2 = client.on("userDeleted", (data) => { /* ... */ });

// 取消订阅
unsub1();
unsub2();
```

## API 参考

### ServerChannel

#### 构造函数

```typescript
constructor(raw: Channel)
```

#### 方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `handle()` | `handle<K>(method: K, fn: (params) => Result): void` | 注册方法处理程序 |
| `emit()` | `emit<K>(event: K, data: EventData): void` | 发送事件 |
| `raw_` | `get raw_(): Channel` | 获取原始 channel |

### ClientChannel

#### 构造函数

```typescript
constructor(raw: Channel)
```

#### 方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `call()` | `call<K>(method: K, params, timeoutMs?): Promise<Result>` | 调用服务端方法 |
| `on()` | `on<K>(event: K, handler): () => void` | 订阅事件 |
| `raw_` | `get raw_(): Channel` | 获取原始 channel |

## 最佳实践

1. **定义 Contract**: 在共享的接口文件中定义 `ChannelContract`，确保服务端和客户端使用相同的类型定义。

2. **错误处理**: 在 `handle()` 方法中抛出错误，客户端会收到 rejected promise。

3. **超时处理**: 对于耗时操作，建议客户端指定合理的超时时间。

4. **事件订阅**: 始终保存 `on()` 返回的取消订阅函数，在适当的时候调用它以避免内存泄漏。

5. **类型定义**: Contract 的 `methods` 和 `events` 都是可选的，可以只定义其中一种。

6. **向后兼容**: 添加新方法或事件时，旧的客户端仍然可以工作（只是不知道新的类型）。

## 与旧 API 的对比

| 功能 | 旧 API (Channel) | 新 API (ServerChannel/ClientChannel) |
|------|------------------|--------------------------------------|
| 方法调用 | `channel.call("method", params)` | `client.call("method", params)` - 类型安全 |
| 事件监听 | `channel.onReceive(handler)` - 接收所有消息 | `client.on("event", handler)` - 只接收特定事件，类型安全 |
| 事件发送 | `channel.send(data)` | `server.emit("event", data)` - 类型安全 |
| 方法注册 | 手动解析 `__call` 字段 | `server.handle("method", fn)` - 类型安全 |

## 相关文档

- [RpcClient API 参考](./rpc-client-api.md)
- [扩展开发指南](../README.md)
- [类型定义](../../packages/coding-agent/src/core/extensions/)
