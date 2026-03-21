---
paths: .git/**/*, .github/**/*
---

# Git 工作流规范

## 🚫 禁止跳过 Hooks

**严格禁止**: 使用 `--no-verify` 跳过 pre-commit hooks 提交代码

```bash
# ❌ 禁止这样做
git commit --no-verify -m "message"

# ✅ 正确做法 - 让 hooks 运行
git commit -m "message"
```

**理由**:

- Pre-commit hooks 确保代码质量（格式检查、测试运行）
- 跳过 hooks 会将低质量代码提交到仓库
- 影响团队协作和代码审查

### 如果 Hooks 失败怎么办？

1. **运行测试失败** → 修复测试后再提交
2. **格式检查失败** → 运行 `npm run format` 修复
3. **验证器失败** → 修复验证问题
4. **临时文件** → 使用 `.gitignore` 排除

### 紧急情况

如果确实需要绕过 hooks（极少情况）:

```bash
# 1. 先确认原因
npm run test      # 检查测试状态
npm run format     # 检查格式

# 2. 记录原因
# 在 commit message 中说明为什么要跳过 hooks
git commit --no-verify -m "fix: emergency fix

[SKIP-HOOKS] Reason: CI is down, will run tests manually"
```

## 📝 Commit Message 规范

### 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| Type       | 说明      | 示例                                        |
| ---------- | --------- | ------------------------------------------- |
| `feat`     | 新功能    | `feat(todos): add search functionality`     |
| `fix`      | Bug 修复  | `fix: handle null pointer exception`        |
| `docs`     | 文档更新  | `docs(readme): update installation steps`   |
| `style`    | 代码格式  | `style: indent code with 2 spaces`          |
| `refactor` | 重构      | `refactor(api): simplify response handling` |
| `test`     | 测试      | `test: add unit tests for TodoService`      |
| `chore`    | 构建/工具 | `chore: update dependencies`                |

### Subject 主题

- 使用中文或英文
- 简洁描述做了什么
- 不超过 50 字符
- 不以句号结尾

### Body 正文

- 详细描述做了什么
- 说明为什么这么做
- 列出相关 Issue

### 示例

```
feat(todos): 添加搜索功能

- 新增搜索框组件
- 添加标题和描述搜索
- 实现搜索结果高亮

Closes #123

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## 🔄 工作流程

### 分支策略

```bash
# 1. 从 main 创建功能分支
git checkout -b feat/new-feature

# 2. 开发和提交
git add .
git commit -m "feat: add implementation"

# 3. 推送到远程
git push origin feat/new-feature

# 4. 创建 Pull Request
# 在 GitHub 上创建 PR，请求合并到 main

# 5. Code Review 和修改
# 根据反馈修改代码，重复 2-3

# 6. 合并到 main
# PR 审查通过后合并
```

### 提交频率

- 小步快跑：频繁提交，每次提交一个完整的逻辑单元
- 不要堆积大量修改在一个 commit
- 每个 commit 应该能通过测试和构建

## 🔍 Pre-commit Hooks

当前配置的 hooks (`.husky/pre-commit`):

1. **npm run typecheck** - TypeScript 类型检查
2. **npx lint-staged** - 对暂存文件运行格式化和检查
3. **npm run test:smart:staged** - 智能测试（只测试相关文件）

### Hooks 检查内容

```bash
# 1. TypeScript 类型检查
npm run typecheck

# 2. lint-staged - 对暂存文件运行格式化和检查
npx lint-staged

# 3. 智能测试 - 只测试与改动相关的文件
npm run test:smart:staged
```

**注意**:

- lint-staged 的具体配置在 `package.json` 中定义
- 智能测试会分析文件依赖，只运行相关的测试，提升效率

## 📋 检查清单

提交前确认：

- [ ] 代码已通过本地测试
- [ ] 代码已格式化 (`npm run format`)
- [ ] 没有 `console.log` 调试代码
- [ ] 没有 `.only` 或 `.skip` 测试
- [ ] Commit message 符合规范
- [ ] 没有 `--no-verify`
