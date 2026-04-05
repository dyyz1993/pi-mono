# 🚀 快速开始：LSP 环境变量管理扩展

> 5 分钟快速上手 PI 扩展开发

## 📦 安装与运行

### 方式 1: 直接运行（推荐测试）

```bash
# 1. 进入示例扩展目录
cd example-plugin

# 2. 安装依赖
npm install

# 3. 编译 TypeScript
npm run build

# 4. 启动 PI 并加载扩展
pi -e ./dist/index.js

# 5. 在 PI 中测试
你: 使用 lsp_list_env 查看环境变量
你: 使用 lsp_set_env 设置 TEST_VAR 为 hello
你: 列出环境变量
```

### 方式 2: 全局安装

```bash
# 1. 打包为 npm 包
cd example-plugin
npm pack

# 2. 在 PI 中安装
pi install ./lsp-env-manager-1.0.0.tgz

# 3. 启动 PI（自动加载）
pi

# 4. 验证扩展已加载
/pi-env help
```

### 方式 3: 开发模式（热重载）

```bash
# 终端 1: 监听文件变化并编译
cd example-plugin
npm run dev

# 终端 2: 启动 PI
pi -e ./dist/index.js

# 修改代码后，在 PI 中输入:
/reload
```

## 🎯 核心功能演示

### 1. 设置环境变量

**方式 A: 通过 LLM 工具调用**
```
你: 使用 lsp_set_env 工具设置 ANTHROPIC_API_KEY 为 sk-ant-test123
PI: [调用工具] ✓ 已设置环境变量: ANTHROPIC_API_KEY
```

**方式 B: 通过命令行**
```
/lsp-env set ANTHROPIC_API_KEY sk-ant-test123
```

### 2. 从文件加载

```bash
# 创建 .env 文件
cat > .env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-your-key
GITHUB_TOKEN=ghp_your_token
NODE_ENV=development
EOF

# 在 PI 中加载
你: 使用 lsp_load_env 工具从 .env 文件加载环境变量
PI: [调用工具] ✓ 已加载 3 个环境变量
```

### 3. 查看环境变量

```
你: 列出所有环境变量
PI: [调用 lsp_list_env]
环境变量 (3):
  ANTHROPIC_API_KEY=sk-****-****-test123
  GITHUB_TOKEN=ghp_****_token
  NODE_ENV=development
```

### 4. 自动注入到 LSP 命令

```
你: 运行 npx @anthropic-ai/mcp-server-anthropic
PI: [拦截工具调用]
    检测到 LSP 命令，注入环境变量...
    执行: ANTHROPIC_API_KEY=sk-ant-test123 npx @anthropic-ai/mcp-server-anthropic
```

### 5. 状态持久化

```
# 设置环境变量
你: 设置 SESSION_ID 为 abc123

# 重启 PI
/reload

# 环境变量仍然存在
你: 列出环境变量
PI: SESSION_ID=abc123
```

### 6. 清除环境变量

```
你: 清除 TEST_VAR 环境变量
PI: ✓ 已清除环境变量: TEST_VAR

你: 清除所有环境变量
PI: ✓ 已清除 5 个环境变量
```

## 🔧 自定义配置

### 修改敏感信息脱敏规则

编辑 `example-plugin/index.ts`:

```typescript
// 第 68-76 行：脱敏函数
function maskSensitive(key: string, value: string): string {
  const sensitiveKeys = ["API_KEY", "TOKEN", "SECRET", "PASSWORD"];
  if (sensitiveKeys.some(k => key.toUpperCase().includes(k))) {
    // 自定义脱敏逻辑
    if (value.length <= 8) return "****";
    return value.slice(0, 3) + "****" + value.slice(-3);
  }
  return value;
}
```

### 添加 LSP 命令检测规则

编辑 `example-plugin/index.ts`:

```typescript
// 第 78-89 行：LSP 命令检测
const lspPatterns = [
  /npx\s+@anthropic-ai\/mcp-server-/,
  /npx\s+@anthropic-ai\/mcp-server-anthropic/,
  /typescript-language-server/,
  /pylsp/,
  /gopls/,
  /rust-analyzer/,
  // 添加你的 LSP 服务器
];
```

### 配置自动加载 .env

编辑 `example-plugin/index.ts`:

```typescript
pi.on("session_start", async (_event, ctx) => {
  // 自动加载项目根目录的 .env
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    await loadEnvFile(envPath);
    ctx.ui.notify("✓ 已自动加载 .env 文件", "info");
  }
});
```

## 📖 扩展开发流程

### 第 1 步: 创建扩展文件

```bash
mkdir my-extension
cd my-extension
npm init -y
npm install typescript @types/node
```

### 第 2 步: 编写扩展代码

创建 `index.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function(pi: ExtensionAPI) {
  // 1. 注册工具
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "一个自定义工具",
    parameters: Type.Object({
      message: Type.String(),
    }),
    async execute(toolCallId, params) {
      return {
        content: [{ type: "text", text: `处理: ${params.message}` }],
      };
    },
  });

  // 2. 订阅事件
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("扩展已加载!", "info");
  });

  // 3. 注册命令
  pi.registerCommand("my-cmd", {
    description: "我的命令",
    handler: async (args, ctx) => {
      ctx.ui.notify(`执行: ${args}`, "info");
    },
  });
}
```

### 第 3 步: 配置 TypeScript

创建 `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["*.ts"]
}
```

### 第 4 步: 编译与运行

```bash
npx tsc
pi -e ./dist/index.js
```

## 🐛 调试技巧

### 1. 查看扩展日志

```bash
# 启动 PI 并显示详细日志
pi -e ./dist/index.js --verbose

# 查看工具调用
你: 使用 lsp_list_env
# 日志会显示: [lsp-env-manager] Tool called: lsp_list_env
```

### 2. 测试特定功能

```bash
# 只测试工具调用拦截
你: 运行 echo "test"
# 如果输出包含环境变量，说明拦截成功
```

### 3. 检查状态持久化

```bash
# 查看会话数据库
ls ~/.pi/agent/sessions/
sqlite3 ~/.pi/agent/sessions/<latest-session>.jsonl "SELECT * FROM messages WHERE tool_name LIKE 'lsp_%'"
```

### 4. 热重载测试

```bash
# 在 PI 中使用命令
/reload

# 或修改代码后重新编译
npm run build
/reload
```

## 📚 下一步

1. **阅读完整文档**
   - [PI 扩展开发指南](PI_EXTENSION_DEVELOPMENT_GUIDE.md) - 所有 API 详细说明
   - [LSP 环境变量架构](LSP_ENV_ARCHITECTURE.md) - 技术方案设计

2. **探索更多功能**
   - 添加 UI 组件
   - 自定义消息渲染
   - 注册 Provider
   - 跨扩展通信

3. **发布你的扩展**
   ```bash
   # 打包
   npm pack
   
   # 分享给他人
   pi install ./your-extension-1.0.0.tgz
   
   # 或发布到 npm
   npm publish
   ```

## 💡 常见问题

### Q: 扩展加载失败怎么办？

**A**: 检查以下几点：
1. TypeScript 是否正确编译（`ls dist/index.js`）
2. 依赖是否安装（`npm install`）
3. 使用 `--verbose` 查看错误日志

### Q: 工具调用没有被拦截？

**A**: 确保：
1. 事件名称正确（`tool_call`）
2. 工具名称匹配（`event.toolName === "bash"`）
3. 返回正确的 action（`{ action: "modify", input: ... }`）

### Q: 环境变量没有持久化？

**A**: 检查：
1. `session_start` 事件是否正确处理
2. `appendEntry` 是否被调用
3. 查看 [状态恢复逻辑](example-plugin/index.ts:157-176)

### Q: 如何在多个项目中使用？

**A**: 三种方式：
1. **全局安装**: `pi install ./extension.tgz`
2. **项目级配置**: 在 `.pi/extensions/index.ts` 中导入
3. **Pi Package**: 发布到 npm，通过 `pi install npm:@foo/my-extension` 安装

## 🤝 获取帮助

- **Discord 社区**: [https://discord.com/invite/3cU7Bz4UPx](https://discord.com/invite/3cU7Bz4UPx)
- **GitHub Issues**: [https://github.com/badlogic/pi-mono/issues](https://github.com/badlogic/pi-mono/issues)
- **官方文档**: [https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs)

---

**祝你使用愉快！🎉**
