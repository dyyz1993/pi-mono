# Permission 字段 → 单测绑定 Spec

## Why

当前 `checkToolPermission` 的 66 个单测是按**功能模块**组织的（allowlist、blocklist、dangerous bash、path、pattern matching、input edge cases、precedence），不是按**字段**组织的。这使得：
- 新增字段时不知道该在哪加测试
- 每个字段的边界情况（null、undefined、空数组等）分散在各处
- 字段之间的交互（如 `tools` + `disallowedTools` 冲突）缺少独立验证

目标：每个 permission 字段一个独立的 `describe` 组，组内包含该字段的所有测试用例（正常值、边界值、交互）。

## What Changes

将单测文件 `test/permissions.test.ts` 重构为按字段分组的测试：

### 字段分组（每个字段一个 `describe`）

| # | 字段 | describe 名 | 测试数 |
|---|---|---|---|
| 1 | `permissionMode` | `permissionMode field` | ~5 |
| 2 | `tools` (allowlist) | `tools field` | ~8 |
| 3 | `disallowedTools` (blocklist) | `disallowedTools field` | ~8 |
| 4 | `paths.write` | `paths.write field` | ~6 |
| 5 | `paths.read` | `paths.read field` | ~4 |
| 6 | `paths.bash` | `paths.bash field` | ~3 |
| 7 | `DANGEROUS_BASH_PATTERNS` | `dangerous bash patterns` | ~7 |
| 8 | `tools` + `disallowedTools` 冲突 | `tools vs disallowedTools conflict` | ~4 |
| 9 | `matchesToolPattern` | `matchToolName patterns` | ~8 |
| 10 | `inputToRecord` | `inputToRecord parsing` | ~6 |
| 11 | `checkPathPermission` | `checkPathPermission` | ~4 |
| 12 | `normalizeFilePath` | `normalizeFilePath` | ~3 |

### 每个字段的测试覆盖规则

每个字段必须覆盖：
1. **正常值** — 该字段的典型用途
2. **undefined** — 字段未设置时的行为
3. **空数组/空字符串** — 字段为空时的行为
4. **边界值** — 如 `tools: ["bash(*)"]`、`paths.write: ["**"]`
5. **交互** — 该字段与其它字段的交互（如 `tools` + `disallowedTools`）

## Impact

- Affected specs: 权限核心逻辑
- Affected code: `test/permissions.test.ts`（重构，不改 production 代码）
- Existing 66 tests: 全部保留，只重新组织 + 补充缺失测试

## ADDED Requirements

### Requirement: Field-Organized Tests
The system SHALL have each permission field tested in its own `describe` group.

#### Scenario: All fields have dedicated groups
- **WHEN** running tests
- **THEN** each field in `AgentConfig` and `PathConfig` that participates in permission checking has at least one `describe` group

### Requirement: Field Boundary Coverage
The system SHALL test each field with undefined, empty, and typical values.

#### Scenario: undefined handling
- **GIVEN** `allowedTools: undefined`
- **WHEN** `checkToolPermission` runs
- **THEN** allowlist check is skipped (not blocking)

#### Scenario: empty array handling
- **GIVEN** `allowedTools: []`
- **WHEN** `checkToolPermission` runs
- **THEN** all tools are blocked (empty allowlist = nothing allowed)
