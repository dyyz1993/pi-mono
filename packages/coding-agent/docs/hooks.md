# Hooks

Hooks let settings, agents, and skills run extra handlers around runtime events such as tool use.

## Live sources

Pi currently loads hooks from these sources:

| Source | When registered | Source label |
| --- | --- | --- |
| Settings JSON (`.claude/settings.json`, `.pi/settings.json`, and global/policy variants) | Runtime config load/reload | settings scope, such as `project` or `pi-project` |
| Agent frontmatter (`agents/*.md`) | When an agent config is applied | `agent:<name>` |
| Skill frontmatter (`skills/*/SKILL.md`) | When the skill is invoked | `skill:<name>` |

Rules frontmatter is not a hook source. A `hooks` field in `.pi/rules/*.md` or `.claude/rules/*.md` is ignored by the hooks runtime.

## Merge semantics

Hooks are additive. Settings hooks and session hooks are concatenated for the same event; matching groups run in registration order. They do not override each other by event or matcher.

Agent hooks replace the previously active agent hook source for the session. Skill hooks are registered when that skill is invoked.

## Frontmatter behavior

Agent and skill frontmatter use the same `hooks` shape as settings:

```yaml
---
name: example-agent
description: Example agent with a hook
hooks:
  PreToolUse:
    - matcher: bash
      hooks:
        - type: command
          command: echo checked
---
```

Supported persistent handler types are `command`, `http`, `mcp_tool`, `prompt`, and `agent`.

Agent-scoped `Stop` hooks are registered as `SubagentStop`, matching subagent runtime behavior.

Handlers with `once: true` are consumed after their first matching event for the current session registration.
