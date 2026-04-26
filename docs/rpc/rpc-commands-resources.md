---

# RPC 命令 - 资源查询与命令列表

> 本文档详细描述 RPC 协议中的资源查询（技能/扩展/工具）和命令列表命令。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

## `get_skills` - 获取已加载技能

```json
{"id": "req_29", "type": "get_skills"}
```

**响应**：
```json
{
  "id": "req_29",
  "type": "response",
  "command": "get_skills",
  "success": true,
  "data": {
    "skills": [
      {
        "name": "react-patterns",
        "description": "React best practices and patterns",
        "filePath": "/path/to/skills/react-patterns/SKILL.md",
        "baseDir": "/path/to/skills/react-patterns",
        "sourceInfo": { "path": "...", "source": "user", "scope": "user", "origin": "top-level" },
        "disableModelInvocation": false
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 技能名称（小写 + 短横线） |
| `description` | string | 技能描述 |
| `filePath` | string | SKILL.md 文件路径 |
| `baseDir` | string | 技能目录路径 |
| `sourceInfo` | SourceInfo | 来源元数据（path/source/scope/origin） |
| `disableModelInvocation` | boolean | 是否禁用模型自动调用 |

> 技能来源：`~/.pi/skills/`（用户级）、`.pi/skills/`（项目级）、`--skill` 参数、扩展 `resources_discover` 事件。

---

## `get_extensions` - 获取已加载扩展

```json
{"id": "req_30", "type": "get_extensions"}
```

**响应**：
```json
{
  "id": "req_30",
  "type": "response",
  "command": "get_extensions",
  "success": true,
  "data": {
    "extensions": [
      {
        "path": "/path/to/extension.ts",
        "resolvedPath": "/absolute/path/to/extension.ts",
        "sourceInfo": { "path": "...", "source": "project", "scope": "project", "origin": "top-level" },
        "toolNames": ["my_tool", "another_tool"],
        "commandNames": ["my-command"]
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | string | 扩展入口文件原始路径 |
| `resolvedPath` | string | 扩展入口文件绝对路径 |
| `sourceInfo` | SourceInfo | 来源元数据 |
| `toolNames` | string[] | 扩展注册的工具名称列表 |
| `commandNames` | string[] | 扩展注册的斜杠命令名称列表 |

> 与 `get_commands`（`source: "extension"`）的区别：`get_extensions` 返回扩展级别信息，包含该扩展注册的所有工具和命令名称；`get_commands` 返回的是扁平化的命令列表，混合了扩展命令、提示词模板和技能。

---

## `get_tools` - 获取已注册工具

```json
{"id": "req_31", "type": "get_tools"}
```

**响应**：
```json
{
  "id": "req_31",
  "type": "response",
  "command": "get_tools",
  "success": true,
  "data": {
    "tools": [
      {
        "name": "bash",
        "label": "bash",
        "description": "Execute a bash command in the current working directory...",
        "sourceInfo": { "path": "...", "source": "builtin", "scope": "temporary", "origin": "top-level" }
      },
      {
        "name": "my_tool",
        "label": "My Tool",
        "description": "Does something custom",
        "sourceInfo": { "path": "/path/to/extension.ts", "source": "project", "scope": "project", "origin": "top-level" }
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 工具名称（LLM 调用时使用） |
| `label` | string | 人类可读标签（UI 显示） |
| `description` | string | 工具描述（给 LLM 的说明） |
| `sourceInfo` | SourceInfo | 来源元数据 |

> 包含内置工具（bash、read、write、edit 等）和扩展注册的工具。工具名称按首次注册去重。

---

## `get_commands` - 获取可用命令

```json
{"id": "req_29", "type": "get_commands"}
```

**响应**：
```json
{
  "id": "req_29",
  "type": "response",
  "command": "get_commands",
  "success": true,
  "data": {
    "commands": [
      {
        "name": "compact",
        "description": "Compact session context",
        "source": "extension",
        "sourceInfo": { "type": "extension", "path": "/path/to/extension.ts" }
      },
      {
        "name": "review",
        "description": "Code review template",
        "source": "prompt",
        "sourceInfo": { "type": "prompt", "path": "/path/to/prompt.md" }
      },
      {
        "name": "skill:react-patterns",
        "description": "React best practices",
        "source": "skill",
        "sourceInfo": { "type": "skill", "path": "/path/to/skill.md" }
      }
    ]
  }
}
```

---
