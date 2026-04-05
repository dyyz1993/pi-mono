# 🚀 从这里开始

> 欢迎来到 PI 扩展开发文档库！

## 🎯 你想要做什么？

### 👉 我想快速使用 LSP 环境变量管理功能

**5 分钟上手** → [QUICKSTART.md](QUICKSTART.md)

**详细配置** → [LSP_ENV_VARIABLES_GUIDE.md](LSP_ENV_VARIABLES_GUIDE.md)

---

### 👉 我想了解技术方案设计

**架构文档** → [LSP_ENV_ARCHITECTURE.md](LSP_ENV_ARCHITECTURE.md)

**实现状态** → [LSP_ENV_IMPLEMENTATION_CHECKLIST.md](LSP_ENV_IMPLEMENTATION_CHECKLIST.md)

---

### 👉 我想开发自己的 PI 扩展

**完整指南** → [PI_EXTENSION_DEVELOPMENT_GUIDE.md](PI_EXTENSION_DEVELOPMENT_GUIDE.md)

**示例代码** → [example-plugin/](example-plugin/)

---

### 👉 我想浏览所有文档

**文档导航** → [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md)

**更新总结** → [DOCUMENTATION_SUMMARY.md](DOCUMENTATION_SUMMARY.md)

---

## 📚 文档地图

```
START_HERE.md (本文件)
│
├─ 快速上手
│  └─ QUICKSTART.md (5 分钟教程)
│
├─ 用户指南
│  └─ LSP_ENV_VARIABLES_GUIDE.md (详细配置)
│
├─ 开发文档
│  ├─ PI_EXTENSION_DEVELOPMENT_GUIDE.md (完整 API)
│  └─ example-plugin/ (可运行示例)
│
├─ 架构文档
│  ├─ LSP_ENV_ARCHITECTURE.md (技术方案)
│  └─ LSP_ENV_IMPLEMENTATION_CHECKLIST.md (实现清单)
│
└─ 导航文档
   ├─ DOCUMENTATION_INDEX.md (主题索引)
   └─ DOCUMENTATION_SUMMARY.md (更新总结)
```

---

## ⚡ 快速测试

想立即看到效果？运行以下命令：

```bash
# 1. 编译示例扩展
cd example-plugin
npm install && npm run build

# 2. 启动 PI 并加载扩展
pi -e ./dist/index.js

# 3. 在 PI 中测试
你: 列出环境变量
你: 设置 TEST_VAR 为 hello
你: 列出环境变量
你: 清除 TEST_VAR
```

---

## 💡 推荐学习路径

### 初次使用（30 分钟）
1. 阅读 [QUICKSTART.md](QUICKSTART.md)（5 分钟）
2. 运行 `example-plugin`（10 分钟）
3. 尝试核心功能（15 分钟）

### 深度理解（2 小时）
1. 阅读 [LSP_ENV_ARCHITECTURE.md](LSP_ENV_ARCHITECTURE.md)（20 分钟）
2. 阅读 [PI_EXTENSION_DEVELOPMENT_GUIDE.md](PI_EXTENSION_DEVELOPMENT_GUIDE.md) 前 3 章（40 分钟）
3. 研究 [example-plugin/index.ts](example-plugin/index.ts)（30 分钟）
4. 阅读 [LSP_ENV_VARIABLES_GUIDE.md](LSP_ENV_VARIABLES_GUIDE.md)（15 分钟）
5. 执行测试清单（15 分钟）

### 扩展开发（4 小时）
1. 阅读 [QUICKSTART.md](QUICKSTART.md)（5 分钟）
2. 完整阅读 [PI_EXTENSION_DEVELOPMENT_GUIDE.md](PI_EXTENSION_DEVELOPMENT_GUIDE.md)（60 分钟）
3. 研究 [example-plugin/index.ts](example-plugin/index.ts)（30 分钟）
4. 修改 `example-plugin`（60 分钟）
5. 开发自己的扩展（120 分钟）

---

## 🆘 需要帮助？

- **文档问题**: 查看 [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md)
- **使用问题**: 查看 [LSP_ENV_VARIABLES_GUIDE.md](LSP_ENV_VARIABLES_GUIDE.md) 的故障排查章节
- **开发问题**: 查看 [PI_EXTENSION_DEVELOPMENT_GUIDE.md](PI_EXTENSION_DEVELOPMENT_GUIDE.md) 的常见问题章节
- **社区支持**: [Discord](https://discord.com/invite/3cU7Bz4UPx)
- **问题反馈**: [GitHub Issues](https://github.com/badlogic/pi-mono/issues)

---

**祝你使用愉快！🎉**
