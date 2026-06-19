# Frozen Files Guard (冻结文件保护)

## 工作原理

项目根目录 `.trae/frozen-files.yaml` 维护一份"已冻结"文件清单。当 AI 尝试修改清单中的文件时，Trae PreToolUse hook (`~/.trae-cn/hooks/freeze-guard.sh`) 会拦截并拒绝操作。

**保护范围**：Write、Edit、SearchReplace 工具 + Bash 中的 `sed -i`、`perl -pi`、`awk -i inplace` 原地编辑命令。

**匹配方式**：glob 通配符（`**` 匹配任意层级目录，`*` 匹配单层）。

## AI 行为规范（循环规则）

### 何时冻结

当一个模块/功能满足以下**全部条件**时，AI 应主动将其加入冻结清单：

1. 功能开发完成
2. 单元测试/集成测试通过（`npm run check` 无错误）
3. 代码审查通过（无遗留 TODO/FIXME/HACK）

冻结操作：编辑 `.trae/frozen-files.yaml`，在 `frozen` 数组中添加条目，同时填写 `path`（源码）和 `testPath`（测试文件）。

**主动加入保护不需要用户确认。**

### 冻结后遇到需要修改时

当 AI 尝试修改冻结文件被拦截后：

1. **不要绕过**：不得通过删除 YAML 条目、修改 glob 范围等方式自行解除保护
2. **告知用户**：明确告知哪个文件被冻结、匹配了哪条规则
3. **请求确认**：请用户手动编辑 `.trae/frozen-files.yaml` 移除或调整对应条目
4. **等待解除**：用户解除后才能继续修改
5. **修改后重新冻结**：修改完成且测试通过后，AI 应将该条目重新加回冻结清单

### 冻结清单维护

- AI 有责任在完成工作后更新冻结清单（主动冻结）
- AI 无权解除冻结（只有用户可以）
- 每次冻结应记录 `reason`、`frozenAt`、`commit`、`changelog`

## 冻结清单格式

文件路径：`.trae/frozen-files.yaml`

```yaml
frozen:
  - path: "src/feature-a/**"                    # 源码 glob 模式（必填）
    testPath: "test/feature-a/**/*.test.ts"      # 测试文件 glob 模式（可选）
    reason: "功能已完成并测试通过"                  # 冻结原因（必填）
    frozenAt: "2026-06-16"                       # 冻结日期
    commit: "abc1234"                            # 关联 commit hash（可选）
    changelog:                                   # 修复记录（可选）
      - fix: "修复描述"
        date: "2026-06-16"
        commit: "abc1234"
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string (glob) | 是 | 源码文件/目录的匹配模式 |
| `testPath` | string (glob) | 否 | 对应测试文件的匹配模式 |
| `reason` | string | 是 | 冻结原因 |
| `frozenAt` | string | 是 | 冻结日期 YYYY-MM-DD |
| `commit` | string | 否 | 冻结时对应的 commit hash，用于追溯 |
| `changelog` | array | 否 | 修复记录列表，记录解决了什么问题 |
| `changelog[].fix` | string | 否 | 修复描述 |
| `changelog[].date` | string | 否 | 修复日期 |
| `changelog[].commit` | string | 否 | 修复对应的 commit hash |

## 如何冻结文件

在 `.trae/frozen-files.yaml` 的 `frozen` 数组中添加条目即可。

## 如何解除冻结

手动编辑 `.trae/frozen-files.yaml`，移除对应条目。AI 无法自行解除冻结。

## 被拦截时的行为

AI 尝试修改冻结文件时，收到拒绝消息：
```
文件已冻结保护，禁止修改: <file>。匹配冻结规则: <pattern>。
如需修改，请手动编辑 .trae/frozen-files.yaml 移除对应条目后再操作。
```

## 相关文件

- 配置文件：`.trae/frozen-files.yaml`
- Hook 脚本：`~/.trae-cn/hooks/freeze-guard.sh`
- Hook 注册：`~/.trae-cn/hooks.json` (PreToolUse → freeze-guard.sh)
