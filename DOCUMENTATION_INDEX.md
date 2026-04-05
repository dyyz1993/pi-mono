# 📖 文档导航

> PI 扩展开发完整文档索引

## 🎯 根据你的角色选择文档

### 👨‍💻 如果你是用户

想要在 PI 中管理 LSP 服务器的环境变量？

1. **[快速开始](QUICKSTART.md)** - 5 分钟上手教程
2. **[LSP 环境变量使用指南](LSP_ENV_VARIABLES_GUIDE.md)** - 详细使用说明

### 👨‍💼 如果你是架构师

想要了解技术方案设计和实现细节？

1. **[LSP 环境变量架构设计](LSP_ENV_ARCHITECTURE.md)** - 完整的技术方案
2. **[实现清单](LSP_ENV_IMPLEMENTATION_CHECKLIST.md)** - 方案状态和测试

### 👨‍💻 如果你是开发者

想要开发自己的 PI 扩展？

1. **[快速开始](QUICKSTART.md)** - 5 分钟上手
2. **[PI 扩展开发指南](PI_EXTENSION_DEVELOPMENT_GUIDE.md)** - 完整 API 文档
3. **[example-plugin/](example-plugin/)** - 可运行的完整示例

---

## 📚 文档详细索引

### 核心文档

#### 1. [LSP_ENV_ARCHITECTURE.md](LSP_ENV_ARCHITECTURE.md)
**技术架构设计文档**

- **目标受众**: 架构师、高级开发者
- **阅读时间**: 20 分钟
- **内容概览**:
  - 问题分析与核心冲突
  - 三种解决方案对比
  - 最终方案：扩展注入 + MCP 服务器代理
  - 详细实施路线图
  - 风险分析与缓解措施
  - 未来扩展方向

**适合场景**:
- 需要评估不同技术方案的优劣
- 需要理解系统架构设计决策
- 需要进行技术选型

---

#### 2. [LSP_ENV_VARIABLES_GUIDE.md](LSP_ENV_VARIABLES_GUIDE.md)
**用户使用指南**

- **目标受众**: PI 用户、运维人员
- **阅读时间**: 15 分钟
- **内容概览**:
  - 三种使用方式（环境变量注入、进程代理、扩展注入）
  - 详细配置说明
  - 常见场景示例
  - 故障排查指南
  - 最佳实践

**适合场景**:
- 想要快速配置 LSP 环境变量
- 遇到配置问题需要排查
- 想要了解最佳实践

---

#### 3. [PI_EXTENSION_DEVELOPMENT_GUIDE.md](PI_EXTENSION_DEVELOPMENT_GUIDE.md)
**扩展开发完整指南**

- **目标受众**: 扩展开发者、贡献者
- **阅读时间**: 60 分钟（完整阅读）
- **内容概览**:
  - 架构概览与设计理念
  - 扩展生命周期详解
  - 所有植入点详细说明（20+ 种事件）
  - 实战示例代码
  - 最佳实践与性能优化
  - 调试技巧
  - 常见问题解答

**适合场景**:
- 开发自定义 PI 扩展
- 需要深入理解 PI 内部机制
- 遇到扩展开发问题

---

#### 4. [LSP_ENV_IMPLEMENTATION_CHECKLIST.md](LSP_ENV_IMPLEMENTATION_CHECKLIST.md)
**实现清单与测试**

- **目标受众**: 开发者、测试人员
- **阅读时间**: 10 分钟
- **内容概览**:
  - 方案实现状态对照表
  - 详细测试清单
  - 安全测试用例
  - 文档对照检查
  - 后续优化方向

**适合场景**:
- 验证功能是否完整实现
- 执行测试用例
- 代码审查

---

#### 5. [QUICKSTART.md](QUICKSTART.md)
**5 分钟快速上手**

- **目标受众**: 所有用户
- **阅读时间**: 5 分钟
- **内容概览**:
  - 快速安装与运行
  - 核心功能演示
  - 自定义配置
  - 扩展开发流程
  - 调试技巧
  - 常见问题

**适合场景**:
- 第一次使用
- 快速验证功能
- 解决常见问题

---

### 代码示例

#### [example-plugin/](example-plugin/)
**完整的 LSP 环境变量管理扩展**

```
example-plugin/
├── index.ts           # 370+ 行完整实现
├── package.json       # 依赖配置
├── tsconfig.json      # TypeScript 配置
├── README.md          # 扩展说明
└── .env.example       # 环境变量示例
```

**核心功能**:
- ✅ 设置/加载/列出/清除环境变量
- ✅ 工具调用拦截与自动注入
- ✅ 状态持久化与会话恢复
- ✅ 敏感信息脱敏
- ✅ Shell 转义处理
- ✅ 状态栏 UI
- ✅ 自定义命令
- ✅ 自定义消息渲染

**使用方式**:
```bash
cd example-plugin
npm install && npm run build
pi -e ./dist/index.js
```

---

## 🗺️ 学习路径

### 路径 1: 快速使用（30 分钟）
```
QUICKSTART.md → 实际使用 → LSP_ENV_VARIABLES_GUIDE.md（遇到问题时）
```

### 路径 2: 深度理解（2 小时）
```
QUICKSTART.md → LSP_ENV_ARCHITECTURE.md → 
example-plugin/index.ts（阅读代码） → 
LSP_ENV_VARIABLES_GUIDE.md
```

### 路径 3: 扩展开发（4 小时）
```
QUICKSTART.md → PI_EXTENSION_DEVELOPMENT_GUIDE.md（前 3 章） → 
example-plugin/index.ts（修改代码） → 
PI_EXTENSION_DEVELOPMENT_GUIDE.md（完整阅读） → 
开发自己的扩展
```

### 路径 4: 架构评估（1 小时）
```
LSP_ENV_ARCHITECTURE.md → 
LSP_ENV_IMPLEMENTATION_CHECKLIST.md → 
PI_EXTENSION_DEVELOPMENT_GUIDE.md（架构章节）
```

---

## 📋 按主题索引

### 环境变量管理
- [快速开始](QUICKSTART.md#核心功能演示) - 功能演示
- [使用指南](LSP_ENV_VARIABLES_GUIDE.md#使用方式) - 详细配置
- [架构设计](LSP_ENV_ARCHITECTURE.md#方案设计) - 技术方案
- [示例代码](example-plugin/index.ts) - 完整实现

### 扩展开发
- [快速开始](QUICKSTART.md#扩展开发流程) - 开发流程
- [开发指南](PI_EXTENSION_DEVELOPMENT_GUIDE.md) - 完整 API
- [示例代码](example-plugin/index.ts) - 参考实现

### 工具调用拦截
- [架构设计](LSP_ENV_ARCHITECTURE.md#方案-3-扩展注入推荐) - 原理说明
- [开发指南](PI_EXTENSION_DEVELOPMENT_GUIDE.md#35-工具调用阶段) - API 文档
- [示例代码](example-plugin/index.ts:95-125) - 实现代码

### 状态持久化
- [开发指南](PI_EXTENSION_DEVELOPMENT_GUIDE.md#32-会话管理阶段) - 会话系统
- [示例代码](example-plugin/index.ts:157-197) - 恢复逻辑

### 测试与调试
- [实现清单](LSP_ENV_IMPLEMENTATION_CHECKLIST.md#测试清单) - 测试用例
- [快速开始](QUICKSTART.md#调试技巧) - 调试方法
- [开发指南](PI_EXTENSION_DEVELOPMENT_GUIDE.md#七调试技巧) - 高级调试

---

## 🔗 外部资源

### 官方文档
- [PI 官方扩展文档](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/extensions.md)
- [PI 扩展示例仓库](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
- [PI API 类型定义](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts)

### 社区资源
- [Discord 社区](https://discord.com/invite/3cU7Bz4UPx)
- [GitHub Issues](https://github.com/badlogic/pi-mono/issues)

---

## 💡 使用建议

### 第一次使用
1. 阅读 [QUICKSTART.md](QUICKSTART.md)（5 分钟）
2. 运行 `example-plugin`（10 分钟）
3. 尝试核心功能（15 分钟）

### 遇到问题
1. 查看 [QUICKSTART.md#常见问题](QUICKSTART.md#常见问题)
2. 查看 [LSP_ENV_VARIABLES_GUIDE.md#故障排查](LSP_ENV_VARIABLES_GUIDE.md#故障排查)
3. 使用 `--verbose` 标志查看日志
4. 在 GitHub Issues 提问

### 深度开发
1. 完整阅读 [PI_EXTENSION_DEVELOPMENT_GUIDE.md](PI_EXTENSION_DEVELOPMENT_GUIDE.md)
2. 研究 `example-plugin/index.ts` 源码
3. 参考 [官方扩展示例](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
4. 在 Discord 社区交流

---

**祝你使用愉快！如有问题，请随时在社区提问。🚀**
