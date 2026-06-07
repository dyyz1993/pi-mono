# Upstream Merge Execution Plan (Revised: Additive-Only Principle)

## Core Principle

**Fork = 上游100%完整功能 + Fork追加层。绝不删减上游任何功能。**

- 所有上游commit必须合并，不跳过任何功能
- 冲突解决原则：**保留双方改动（Union）**，而非二选一
- 合并后验证：`git diff upstream/main..HEAD` 应只显示Fork的追加内容

## Overview

- **Fork point**: `a98e087e5`
- **Fork HEAD**: `feat/fork-v0.78.1`
- **Upstream HEAD**: `89a92207f`
- **上游有效commit**: 20个（4个merge commit无独立内容，自动跳过）
- **策略**: `git merge upstream/main` 一次性合并 + 手动解决冲突

## 为什么用 merge 而不是 cherry-pick

| | `git merge` | cherry-pick x20 |
|---|---|---|
| 保留上游历史 | 完整保留 | 只有patch，不保留原commit |
| 冲突解决 | 一次性，全局视角 | 分散，容易遗漏 |
| 合并后关系 | fork是upstream的后裔 | fork和upstream平行 |
| 符合"additive"原则 | 天然双向保留 | 需手动确保不丢 |

**采用 `git merge upstream/main --no-commit`**，手动解决所有冲突后一次性提交。

## 上游20个有效commit（全部合并，不跳过）

### 安全加固（必须合并）
| Hash | Subject | 风险 |
|------|---------|------|
| `135fb545f` | auth文件创建时设0o600权限 | 低 |
| `ba6e5298d` | OAuth浏览器启动加固 + open-browser.ts | 中 |
| `ea3465a8e` | 扩展缓存迁移到安全目录 | 低 |
| `89a92207f` | **项目信任系统**（+1028行，28文件） | 高 |

### Bug修复（必须合并）
| Hash | Subject | 风险 |
|------|---------|------|
| `83afcdc24` | 清理过期codex模型 | 低 |
| `c45787411` | 7个工具括号样式修复 | 低 |
| `e9a932219` | skill/用户消息间距修复 | 中 |
| `b9bfa7ed4` | OpenRouter路由兼容性修复 | 低 |

### 新功能（必须合并）
| Hash | Subject | 风险 |
|------|---------|------|
| `51df39b9b` | ZAI Coding Plan China provider | 低 |
| `db594d3a5` | Footer缓存命中率显示 | 低 |

### 文档（必须合并）
| Hash | Subject | 风险 |
|------|---------|------|
| `86314bf38` | 容器化指南 + Gondolin VM示例 | 低 |
| `dc7b547f6` | 移除平台说明 | 低 |
| `4f7d756df` | tsconfig排除Gondolin | 低 |
| `e4d6f45ef` | 提交规范文档 | 低 |
| `c52c22b39` | Issue查看命令文档 | 低 |

### 生成文件 + Changelog（必须合并）
| Hash | Subject | 风险 |
|------|---------|------|
| `f9ce0bf0e` | 更新生成模型列表 | 中 |
| `1d33a8eb7` | 更新图片模型列表 | 低 |
| `e0c2813a2` | Changelog审计 | 低 |

### 版本发布（合并，保留双方版本信息）
| Hash | Subject | 风险 | 处理 |
|------|---------|------|------|
| `592c34c05` | Release v0.78.1 | 中 | Fork已有v0.78.1，合并CHANGELOG条目，版本号取Fork的 |
| `ca66adfe6` | Add [Unreleased] section | 低 | 直接合并 |

## 执行步骤

### Step 1: 准备

```bash
# 确保工作区干净
git stash list  # 确认没有stash
git status      # 确认只有session-supervisor的改动

# 创建合并分支
git checkout -b merge/upstream-sync
```

### Step 2: 启动合并

```bash
git merge upstream/main --no-commit
# 预期：大量冲突，这是正常的
```

### Step 3: 解决冲突（按风险分层处理）

#### 3.1 自动解决层（机械性冲突）

这些文件Fork只做了 `@earendil-works` -> `@dyyz1993` 改名，冲突解决策略：

```bash
# 对每个冲突文件，保留双方改动 + 确保用@dyyz1993
for file in \
  packages/coding-agent/src/core/tools/read.ts \
  packages/coding-agent/src/core/tools/find.ts \
  packages/coding-agent/src/core/tools/ls.ts \
  packages/coding-agent/src/core/tools/write.ts \
  packages/coding-agent/src/core/tools/grep.ts \
  packages/coding-agent/src/core/auth-storage.ts \
  packages/coding-agent/src/modes/interactive/components/footer.ts \
  packages/coding-agent/src/modes/interactive/components/bash-execution.ts \
; do
  # 接受上游改动，然后全局替换包名
  git checkout --theirs $file
  sed -i '' 's/@earendil-works/@dyyz1993/g' $file
  git add $file
done
```

#### 3.2 手动解决层（需逐个审查）

| 文件 | 上游改了什么 | Fork改了什么 | 解决策略 |
|------|------------|------------|---------|
| **`main.ts`** | 信任系统启动流程 + `resolveProjectTrusted` | tierModels/maxTurns/outputSchema + 包名改名 | **保留双方**：信任系统启动流程 + Fork的tierModels/maxTurns |
| **`settings-manager.ts`** | projectTrust构造参数 + 信任方法 + setProject重构 | tierModels/mcp字段 + applyOverrides重写 + tier方法 | **保留双方**：信任方法 + Fork的tier/mcp字段和方法 |
| **`args.ts`** | `--approve`/`--no-approve` | `--output-schema`/`--max-turns` | **Union**：4个新参数都保留 |
| **`interactive-mode.ts`** | `/trust`命令 + 信任警告 + showTrustSelector | extension context字段 + tierModels参数 + 包名改名 | **保留双方**：信任命令 + Fork的extension context |
| **`index.ts`** | 导出信任类型 | 大量新增导出 | **Union**：所有导出都保留 |
| **`login-dialog.ts`** | openBrowser重构 | 包名改名 | 取上游openBrowser + 应用@dyyz1993改名 |
| **`package-manager-cli.ts`** | 信任解析 | 包名改名 | 取上游 + 应用改名 |
| **`package-manager.ts`** | 信任守卫(~100行) | 注释中包名改名 | 取上游 + 应用注释改名 |
| **`bash.ts`** | 括号修复 | 包名改名 + timeout/desc功能 | **保留双方**：括号修复 + Fork的timeout功能 + 改名 |
| **`grep.ts`** | 括号修复 | 包名改名 + search抽象重构 | **保留双方**：括号修复 + Fork的重构 + 改名 |

#### 3.3 新文件（直接接受 + 改名检查）

```bash
# 新文件直接接受
git add packages/coding-agent/src/core/trust-manager.ts
git add packages/coding-agent/src/modes/interactive/components/trust-selector.ts
git add packages/coding-agent/src/utils/open-browser.ts
git add packages/coding-agent/test/trust-manager.test.ts
git add packages/coding-agent/test/trust-selector.test.ts
git add packages/coding-agent/docs/containerization.md
git add packages/coding-agent/examples/extensions/gondolin/

# 检查新文件中的@earendil-works引用
grep -r "@earendil-works" packages/coding-agent/src/core/trust-manager.ts \
  packages/coding-agent/src/modes/interactive/components/trust-selector.ts \
  packages/coding-agent/src/utils/open-browser.ts
# 如有，替换为@dyyz1993
```

#### 3.4 生成文件处理

```bash
# models.generated.ts: 先接受上游版本，合并后用脚本重新生成
git checkout --theirs packages/ai/src/models.generated.ts
git add packages/ai/src/models.generated.ts
# 合并完成后运行：
# node packages/ai/scripts/generate-models.ts
```

#### 3.5 文档冲突

```bash
# README.md: 手动合并，保留双方内容
# CHANGELOG.md: 手动合并，保留双方的Unreleased条目
# AGENTS.md: 保留Fork版本（已有更详细的规范），手动追加上游新增条目
```

### Step 4: 全局改名检查

```bash
# 确保整个代码库没有残留的@earendil-works引用
grep -r "@earendil-works" packages/ --include="*.ts" | grep -v node_modules | grep -v dist
# 如有，批量替换
find packages/ -name "*.ts" -not -path "*/node_modules/*" -not -path "*/dist/*" \
  -exec sed -i '' 's/@earendil-works/@dyyz1993/g' {} \;
```

### Step 5: 验证

```bash
# 类型检查 + lint
npm run check

# 信任系统测试
node ../../node_modules/vitest/dist/cli.js --run \
  test/trust-manager.test.ts \
  test/trust-selector.test.ts \
  test/settings-manager.test.ts \
  test/args.test.ts \
  test/resource-loader.test.ts \
  test/package-command-paths.test.ts

# Fork自有功能回归测试
node ../../node_modules/vitest/dist/cli.js --run \
  test/output-guard-truncation.test.ts

# 全量非e2e测试
./test.sh
```

### Step 6: 提交合并

```bash
git add -A  # 注意：仅在merge冲突解决后使用
git commit -m "merge: sync upstream main (24 commits) — additive merge

Merges all 24 upstream commits into fork, preserving both sides:
- Upstream: project trust system, OAuth hardening, ZAI provider,
  cache hit rate, containerization docs, Gondolin VM example,
  tool hint fixes, OpenRouter routing fix
- Fork: tier models, MCP settings, maxTurns, outputSchema,
  agent-permissions, file-time-guard, output-guard,
  @dyyz1993 rebrand, extension context APIs

Conflicts resolved with additive principle: keep both sides' changes.
All @earendil-works references rebranded to @dyyz1993.
"
```

### Step 7: 合并到主分支

```bash
git checkout feat/fork-v0.78.1
git merge merge/upstream-sync
git branch -d merge/upstream-sync
```

## 冲突解决原则（Quick Reference）

| 冲突类型 | 原则 | 示例 |
|----------|------|------|
| 包名改名 vs 功能改动 | 取功能改动 + 应用改名 | `@earendil-works` -> `@dyyz1993` |
| 上游新功能 vs Fork新功能 | **两者都保留** | 信任系统 + tierModels共存 |
| 上游重构 vs Fork重构 | 手动3-way合并 | settings-manager.ts |
| 版本号冲突 | 取Fork版本 | Fork已是v0.78.1 |
| 生成文件冲突 | 取上游 + 重新生成 | models.generated.ts |

## 预期冲突文件清单

| 风险 | 文件 | 数量 |
|------|------|------|
| **高** | `main.ts`, `settings-manager.ts` | 2 |
| **中** | `args.ts`, `interactive-mode.ts`, `index.ts`, `login-dialog.ts`, `bash.ts`, `grep.ts`, `models.generated.ts` | 7 |
| **低** | 其余所有冲突文件（包名改名类） | ~34 |
| **新增** | trust-manager, trust-selector, open-browser, gondolin, containerization | 10+ |

## 关键语义验证点

1. **`applyOverrides(x, "project")` 在不信任项目上会抛异常** — 这是信任系统与Fork的applyOverrides重写的交互点。期望行为：不信任时不允许写项目设置。
2. **`runtimeSettingsManager` 同时支持信任检查和tierModels** — main.ts中的SettingsManager实例必须同时拥有上游的`projectTrusted`参数和Fork的`getTierModels()`方法。
3. **信任系统不拦截builtin extensions** — agent-permissions等内置扩展始终加载，不受项目信任状态影响。
4. **`--approve` flag 与 `--max-turns`/`--output-schema` 共存** — args.ts的4个新参数都需要正常工作。

## Post-Merge: 确认 Additive 原则

```bash
# 验证：diff上游应该只显示Fork的追加内容，没有上游代码的删除
git diff upstream/main..HEAD --stat | grep -E "^\s" | grep -v "+" | head -20
# 如果看到大量删除（-号），说明合并不完整，需要检查
```
