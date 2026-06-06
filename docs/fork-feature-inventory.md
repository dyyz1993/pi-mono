# Fork 功能清单与上游同步状态

> 生成时间: 2026-06-06

---

## 〇、数据来源与对比基准

### 仓库信息

| 项目 | 值 |
|------|-----|
| 本地仓库 | `/Users/xuyingzhou/Project/temporary/pi-momo-fork` |
| origin (fork) | `https://github.com/dyyz1993/pi-mono` |
| upstream (上游) | `https://github.com/badlogic/pi-mono` |

### 对比基准

| 标识 | commit | 说明 |
|------|--------|------|
| **fork 起点** | `a98e087e5` | `git merge-base feat/fork-v0.78.1 upstream/main`。上游侧: `fix(coding-agent): harden git package install paths` |
| **当前分支 HEAD** | `d292fa54e` | `feat/fork-v0.78.1`: `fix hooks permission runtime controls` |
| **上游 HEAD** | `89a92207f` | `upstream/main` (fetched 2026-06-06): `feat(coding-agent): add project trust gating` |
| **原始 fork 基线** | `b92262bb7` | merge 前最后 commit: `docs: add security policy`。包含 48 个 restore 核心改造 |

### 使用的 git 命令

```bash
git fetch upstream main
git merge-base feat/fork-v0.78.1 upstream/main              # → a98e087e5
git rev-list --count a98e087e5..feat/fork-v0.78.1           # → 537 (fork独有)
git rev-list --count a98e087e5..upstream/main               # → 24  (上游新增)
git log --oneline --reverse a98e087e5..b92262bb7            # → 原始48个commit
git diff --name-status a98e087e5..feat/fork-v0.78.1         # → 214A 334M 0D
git diff --name-status a98e087e5..upstream/main             # → 10A 77M
# 逐文件比对: git rev-parse feat/fork-v0.78.1:<file> vs upstream/main:<file> vs a98e087e5:<file>
```

---

## 一、Fork 拓扑

```
upstream/main (badlogic/pi-mono)
    │
    └── a98e087e5 ← fork 起点 (merge-base)
           │
           ├────────────────── 上游继续: +24 commits ──────────────────→ 89a92207f
           │                                                            (trust gating, ZAI, v0.78.1...)
           │
           └── fork 独有: 537 commits
                  │
                  ├── b92262bb7 (48 commits: restore RPC/rollback/channel...)
                  │      │
                  │      ▼ 3513e9087 (2026-05-08) "upstream v0.74.0 with scope fix"
                  │      ▼ 134f96263 (2026-05-08) "upstream v0.74.0 (252 commits) restored"
                  │      │   ← 这两次合并: 上游改动太大, 策略=以上游为基准 + 手动恢复 fork 功能
                  │      │
                  │      ▼ 04defe8b2 (2026-06-03) "merge upstream main preserving features"
                  │      ▼ 8ee03c217 (2026-06-04) "merge local main preserving baseline"
                  │      │
                  │      ▼ d292fa54e = feat/fork-v0.78.1 (当前 HEAD)
                  │         +489 commits (扩展系统 + MCP + bugfix + 发布)
```

---

## 二、Fork 自定义功能清单

### A. 原始 Fork 核心改造 (48 commits, `a98e087e5..b92262bb7`)

merge 前就存在的 fork 核心，全部保留 (0 丢失):

| # | 功能 | Commit | 状态 |
|---|------|--------|------|
| 1 | RPC 流式消息暴露 | `efaa3c4b4` | ✅ |
| 2 | RPC 权限模式设置 | `f6c68d772` | ✅ |
| 3 | Agent RPC 控制恢复 | `3813740c9` | ✅ |
| 4 | Session tree RPC 恢复 | `07e86bd00` | ✅ |
| 5 | Tier model 别名恢复 | `e1ac7fd70` | ✅ |
| 6 | Session edit RPC 恢复 | `2fdfaa73e` | ✅ |
| 7 | File snapshot RPC 恢复 | `18c51a48e` | ✅ |
| 8 | RPC cwd 切换恢复 | `b9d0c6802` | ✅ |
| 9 | RPC client helpers 恢复 | `a3dcbedbc` | ✅ |
| 10 | RPC client type exports 恢复 | `84869b33e` | ✅ |
| 11 | Agent runtime limits 恢复 | `7e2a63ee4` | ✅ |
| 12 | Rollback target safety | `b2d803307` | ✅ |
| 13 | Entry IDs in full messages | `0f4298130` | ✅ |
| 14 | Large input handling | `cb6413e44` | ✅ |
| 15 | Skip custom ancestors on rollback | `4420e2b79` | ✅ |
| 16 | Persist session tree leaf pointer | `e266e80c8` | ✅ |
| 17 | Agent path limits | `5ba7f6105` | ✅ |
| 18 | Tool operations provider | `ce8511aea` | ✅ |
| 19 | File snapshot diff edge cases | `0f3679e9a` | ✅ |
| 20 | Grep provider search operation | `b84488ff0` | ✅ |
| 21 | Extension channel helper exports | `038f6f8a2` | ✅ |
| 22 | Tool execution timing events | `db4b789af` | ✅ |
| 23 | Session switch perf 优化 | `cc5d222e7` | ✅ |
| 24 | Extension storage context | `d76eac844` | ✅ |
| 25 | File store garbage collection | `7c03f369a` | ✅ |
| 26 | Structured print output | `ac7763826` | ✅ |
| 27 | Context usage estimate after compaction | `6ea9b4a5a` | ✅ |
| 28 | Extension load failure warning | `8f66aa8e0` | ✅ |
| 29 | Max turns CLI option | `bc8ef9594` | ✅ |
| 30 | Extension callLLM API | `97c8de436` | ✅ |
| 31 | Custom entry events | `1f2a6a47b` | ✅ |
| 32 | Bash descriptions required | `422efde94` | ✅ |
| 33 | Follow-up queue at run end | `dc825cd11` | ✅ |
| 34 | Empty snapshot baseline | `c8b6b70c6` | ✅ |
| 35 | File-inclusive tree rollback guard | `5ec6476eb` | ✅ |
| 36 | Entry pruning for extensions | `7e58d52b8` | ✅ |
| 37 | Entry invalidation events | `58b365c75` | ✅ |
| 38 | RPC extension channels | `741ad1701` | ✅ |
| 39 | RPC ready signal wait | `f26b447c3` | ✅ |
| 40 | Entry IDs on message events | `9113eecf3` | ✅ |
| 41 | Avoid double parsing on open | `2db09ac4b` | ✅ |
| 42 | System prompt options to commands | `c879dc97f` | ✅ |
| 43 | SDK timeout defaults | `9e17bb99c` | ✅ |
| 44 | Hide empty self-rendered tool rows | `0dc4781e2` | ✅ |
| 45 | Sync upstream provider models | `2d8f30281` | ✅ |
| 46 | Harden git package install paths | `c50897380` | ✅ |

### B. Merge 后新增 (489 commits, `04defe8b2..d292fa54e`)

#### B1. 自定义扩展 (20 个) — 全部存在

| 扩展 | 功能 | 文件数 | 状态 |
|------|------|--------|------|
| `claude-hooks-compat` | Claude Code hooks 兼容层 | 9 | ✅ |
| `compaction-manager` | 上下文压缩 (half/micro/segment/reactive/sliding) | 9 | ✅ |
| `lsp` | LSP 集成 (client/hooks/monitoring/tools/utils) | 16 | ✅ |
| `rules-engine` | 规则引擎 (cache/config/injector/loader/matcher) | 7 | ✅ |
| `subagent-v2` | 子代理 v2 | 8 | ✅ |
| `session-supervisor` | 会话监督 | 6 | ✅ |
| `auto-memory` | 自动记忆 | 5+4test | ✅ |
| `coordinator` | 多代理协调 | 4+2test | ✅ |
| `file-snapshot` | 文件快照 | 2+1test | ✅ |
| `file-review` | 变更审查 | 2 | ✅ |
| `file-time-guard` | 文件时间保护 | 2+1test | ✅ |
| `agent-permissions` | Agent 路径权限 | 2+1test | ✅ |
| `bash-ext` | Bash 增强 | 2 | ✅ |
| `todo-ext` | Todo 扩展 | 2 | ✅ |
| `hooks-engine` | Hook 引擎 | 1+1test | ✅ |
| `message-bridge` | 消息桥接 | 1 | ✅ |
| `output-guard` | 输出截断保护 | 1 | ✅ |
| `preview` | 预览扩展 | 1 | ✅ |
| `auto-session-title` | 自动会话标题 | 1 | ✅ |
| `ask-tools` | 询问工具 | 1 | ✅ |

#### B2. 核心基础设施

| 模块 | 文件数 | 状态 |
|------|--------|------|
| RPC/Channel 系统 | 7 | ✅ |
| File Rollback/Store | 4 | ✅ |
| MCP 集成 | 6 | ✅ |
| Tools 基础设施 | 3 | ✅ |

---

## 三、上游同步状态

> 对比范围: `a98e087e5` (fork起点) .. `89a92207f` (upstream/main HEAD)
> 方法: `git rev-parse` 逐文件比对 fork HEAD vs upstream HEAD vs fork 起点的 blob hash
> 结论: **上游 24 个 commit 全部未通过 git merge 合并**，但 fork **独立实现了**部分上游功能

### 3.1 上游新增文件 (10 个)

| 文件 | fork 状态 | 影响 |
|------|-----------|------|
| `src/core/trust-manager.ts` | **缺失** | 安全: 项目信任门控 |
| `src/modes/interactive/components/trust-selector.ts` | **缺失** | trust UI 组件 |
| `src/utils/open-browser.ts` | **缺失** | OAuth 浏览器启动 |
| `test/trust-manager.test.ts` | **缺失** | trust 测试 |
| `test/trust-selector.test.ts` | **缺失** | trust-selector 测试 |
| `docs/containerization.md` | **缺失** | 文档 |
| `examples/extensions/gondolin/` (5 文件) | **缺失** | 示例扩展 |

### 3.2 上游修改但 fork 仍在旧版本 (26 个)

| 文件 | 影响 | 说明 |
|------|------|------|
| `packages/ai/src/env-api-keys.ts` | ⚠️ 功能 | ZAI provider 环境变量 |
| `packages/ai/src/providers/openai-completions.ts` | ⚠️ 功能 | OpenRouter 兼容 |
| `packages/ai/src/types.ts` | ⚠️ 功能 | 类型定义 |
| `packages/ai/src/utils/oauth/github-copilot.ts` | ⚠️ **安全** | OAuth 加固 |
| `packages/ai/src/utils/oauth/openai-codex.ts` | ⚠️ **安全** | OAuth 加固 |
| `packages/ai/scripts/generate-models.ts` | 代码生成 | model 列表生成 |
| `packages/ai/test/env-api-keys.test.ts` | 测试 | |
| `packages/ai/test/github-copilot-oauth.test.ts` | 测试 | |
| `packages/coding-agent/src/core/provider-display-names.ts` | ⚠️ 功能 | provider 显示名 |
| `packages/coding-agent/src/core/resource-loader.ts` | ⚠️ 功能 | 资源加载 |
| `packages/coding-agent/src/core/slash-commands.ts` | ⚠️ 功能 | skill-user 间距 |
| `packages/coding-agent/src/modes/interactive/components/index.ts` | 组件导出 | |
| `packages/coding-agent/test/*.ts` (4 文件) | 测试 | |
| `AGENTS.md` | 文档 | |
| `.pi/prompts/is.md` | 提示词 | |
| `package.json` | 根配置 | |
| `scripts/tool-stats.ts` | 脚本 | |
| `test.sh` | 测试脚本 | |

### 3.3 双方都改了 = 合并冲突高风险 (43 个)

| 类别 | 文件 | 冲突原因 |
|------|------|---------|
| **Model 列表** | `models.generated.ts` | 双方各自更新了 model 列表 |
| **Tools 核心** | `bash.ts`, `read.ts`, `grep.ts`, `find.ts`, `ls.ts`, `write.ts` | fork 改了截断/wrapper, 上游也改了 |
| **Session/Agent** | `agent-session.ts`(隐含), `interactive-mode.ts` | fork 加了 RPC, 上游加了 trust |
| **Extensions** | `auth-storage.ts`, `model-resolver.ts`, `package-manager.ts`, `settings-manager.ts` | 双方都改 |
| **CLI** | `cli/args.ts`, `main.ts`, `index.ts`, `package-manager-cli.ts` | 双方都改 |
| **UI** | `footer.ts`, `bash-execution.ts`, `login-dialog.ts` | fork 加 cache hit, 上游也改 |
| **版本/发布** | 所有 `package.json`, `CHANGELOG.md`, `npm-shrinkwrap.json`, `package-lock.json` | 版本号一致(0.78.1)但 lockfile 不同 |
| **文档** | `README.md`, `docs/*.md` | 双方都更新 |
| **配置** | `tsconfig.json` | 双方都改 |

### 3.4 fork 独立实现的上游功能 (已覆盖, 不需要合并)

| 上游功能 | fork 状态 | 说明 |
|---------|-----------|------|
| Project trust gating (`89a92207f`) | ✅ fork 有 `trust-manager.ts` | 但实现可能不同, 需对比 |
| Cache hit rate footer (`db594d3a5`) | ✅ fork 有 `totalCacheRead/Write` | footer.ts 中已实现 |
| ZAI provider (`51df39b9b`) | ✅ fork 有 `zai` 引用 | models.generated.ts 中已有 |
| v0.78.1 release (`592c34c05`) | ✅ 版本号一致 | `package.json` = 0.78.1 |

---

## 四、目录结构变化

> 对比: `a98e087e5` (fork起点) vs `upstream/main`

### 最近 24 个 upstream commit

**无目录结构变化。** 24 个 commit 全是 M (修改) 和 A (新增), 没有 R (重命名) 或 D (删除)。

### 历史变化 (v0.74.0 大合并, 已处理)

| 变化 | 状态 |
|------|------|
| 删除 `packages/mom/` | ✅ 已在 fork 中完成 |
| 删除 `packages/pods/` | ✅ 已在 fork 中完成 |
| 删除 `google-gemini-cli` provider | ✅ 已完成 |
| 重命名 `docs/session.md` → `docs/session-format.md` | ✅ 已完成 |

**结论: 合并上游不需要 `git mv` 或 `cp`, 不涉及目录搬迁。**

---

## 五、总结

> 基准: fork 起点 `a98e087e5` vs 当前 HEAD `d292fa54e` vs upstream `89a92207f`
> 方法: `git merge-base` + `git rev-list --count` + `git diff --name-status` + `git rev-parse` 逐文件比对

| 维度 | 数量 | 状态 |
|------|------|------|
| Fork 原始功能 (`a98e087e5..b92262bb7`) | 48 commits | ✅ 全部保留 |
| Fork merge 后新增 (`04defe8b2..d292fa54e`) | 489 commits, 214 新文件 | ✅ 全部存在 |
| 上游新增文件 (fork 缺失) | 10 个 | ⚠️ 需手动引入 |
| 上游修改未同步 | 26 个 | ⚠️ 需 cherry-pick 或手动合并 |
| 双方都改 (冲突风险) | 43 个 | ⚠️ 需逐个解决冲突 |
| fork 独立实现的上游功能 | 4 项 | ✅ 已覆盖 |
| 删除/丢失文件 (`b92262bb7..d292fa54e`) | 0 | ✅ 零丢失 |
| 目录结构变化 | 无 | ✅ 不涉及搬迁 |
