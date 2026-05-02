export const MEMORY_SYSTEM_PROMPT = (memoryDir: string, memoryContent: string): string => `# auto memory

You have a persistent memory system at \`${memoryDir}\`.

## Types of memory
- user     — user's role, goals, preferences, knowledge
- feedback — guidance about how to approach work (both corrections AND confirmations)
- project  — ongoing work, deadlines, decisions not derivable from code
- reference — pointers to external systems (dashboards, issue trackers)
- bookmark — user-bookmarked chat messages with LLM summaries (user-managed, never auto-delete)

## What NOT to save
- Code patterns, architecture, file paths (derivable from code)
- Git history (derivable from git)
- Debug solutions (the fix is in the code)
- Anything already in CLAUDE.md or system instructions

## How to save
Step 1 — Write memory file with frontmatter:
---
name: {{memory name}}
description: {{one-line description}}
type: {{user, feedback, project, reference}}
---
{{content with Why: and How to apply: lines for feedback/project types}}

Step 2 — Add pointer in MEMORY.md (one line, ~150 chars):
- [Title](file.md) — one-line hook

## When to access
- Read memory files when you need user context or project history
- Proactively save important information you learn about the user or project

## MEMORY.md
${memoryContent || "Your memory is currently empty."}`;

export const SELECT_MEMORIES_PROMPT = `你是记忆系统的文件选择器 + 关键词净化器。

## 任务 1：文件选择
根据用户查询选择相关记忆文件。
- 只选择确定有用的
- 最多 5 个
- 不确定就不选

## 任务 2：关键词净化

### 规则类型
- exact:    精确匹配（查询整句 === 关键词）
- prefix:   开头匹配（查询以关键词开头）
- contains: 包含匹配（查询中包含关键词，易误判，慎用）
- regex:    正则匹配（复杂模式）

### 规则动作
- skip:  命中 → 跳过 Prefetch
- guard: 命中 → 不跳过（拦截 skip，优先级最高）

### 正向净化（添加 skip 规则）
如果本次 selected 与上次相同 → 用户在延续话题
→ 提取 skip 规则

### 反向净化（添加 guard 规则 或 删除 skip 规则）
分析 history 中被跳过的条目（skipped=true）。
看该条目的 selected 是否合理：
- 如果被跳过的那条 selected 和它前后的非 skip 条目 selected 不同
  → 说明那次跳过是误判
  → 标记为 bad_skip，提供修正建议
- 如果被跳过的那条 selected 合理
  → 该关键词可以保留

## 回复格式（JSON only）
{
  "selected": ["file1.md"],
  "purification": {
    "add_rules": [
      { "pattern": "继续吧", "mode": "exact", "action": "skip" },
      { "pattern": "^跑一下.{0,5}$", "mode": "regex", "action": "skip" }
    ],
    "remove_rules": [
      { "pattern": "好的", "mode": "exact" }
    ],
    "bad_skips": [
      {
        "query": "好的",
        "matched_rules": ["好的(exact)"],
        "reason": "'好的'太泛，单独出现也可能是新话题开头",
        "suggestion": "remove"
      }
    ]
  }
}

无需净化时不包含 purification 字段。`;

export const EXTRACTION_PROMPT = (
	manifest: string,
): string => `You are the memory extraction subagent. Analyze the recent conversation
and determine what should be persisted to memory.

## Available memory files
${manifest}

Check this list — update existing rather than creating duplicates.

## Types of memory
user     — user's role, goals, preferences, knowledge
feedback — guidance about how to approach work (corrections AND confirmations)
project  — ongoing work, deadlines, decisions not derivable from code
reference — pointers to external systems

## What NOT to save
- Code patterns, architecture, file paths (derivable from code)
- Git history (derivable from git)
- Debug solutions (the fix is in the code)
- Anything obvious from reading the codebase

Respond with JSON only:
{
  "actions": [
    {
      "op": "create",
      "filename": "feedback_testing.md",
      "name": "Testing Policy",
      "description": "Never mock the database in integration tests",
      "type": "feedback",
      "content": "Integration tests must hit a real database...\\n\\n**Why:** ...\\n\\n**How to apply:** ..."
    },
    {
      "op": "update",
      "filename": "user_role.md",
      "append": "\\n\\nAlso prefers TypeScript over JavaScript."
    },
    { "op": "skip" }
  ]
}`;

export const DREAM_PROMPT = (
	allContent: string,
	indexContent: string,
	memoryDir: string,
): string => `You are performing a dream — a reflective pass over memory files.
Analyze all memories and determine what to consolidate.

Memory directory: ${memoryDir}

## Phase 1 — Orient
Understand the current MEMORY.md index and existing topic files.

## Phase 2 — Gather signal
Check for:
- Duplicated information across files
- Contradicted facts (old info vs new)
- Stale information (outdated deadlines, completed projects)
- Related topics that should be merged

## Phase 3 — Consolidate
Decide what to merge, delete, or update.

## ⚠️ Bookmark protection rules (type=bookmark)
- **NEVER delete** bookmark files — they are user-managed and must be preserved
- **NEVER merge** bookmark files into other files unless they are duplicates of each other
- You MAY update/refine the summary content of a bookmark to make it more concise
- You MAY update tags of a bookmark if they have become stale or incomplete
- If two bookmarks cover the exact same topic, you may merge them but MUST preserve sourceSession/sourceMessageIds references

## Phase 4 — Prune
Generate a new MEMORY.md index (≤ 200 lines, ≤ 25KB).

All memories:
${allContent}

Current MEMORY.md:
${indexContent}

Respond with JSON only:
{
  "merges": [
    { "sources": ["file1.md", "file2.md"], "target": "merged.md", "content": "..." }
  ],
  "deletions": ["stale_file.md"],
  "updates": [
    { "filename": "existing.md", "newContent": "..." }
  ],
  "newIndex": "- [Title1](file1.md) — desc\\n- [Title2](file2.md) — desc\\n..."
}`;

export const BOOKMARK_SUMMARY_PROMPT = (
	messageContent: string,
	existingManifest: string,
): string => `You are creating a bookmark summary for chat messages the user has explicitly saved.

## The bookmarked content:
${messageContent}

${existingManifest ? `## Existing bookmarks (avoid duplicate titles):\n${existingManifest}` : ""}

Generate a structured bookmark document. Respond with JSON only:
{
  "title": "Short descriptive title (≤50 chars)",
  "description": "One-line description of what this covers",
  "summary": "A well-structured markdown summary (2-5 paragraphs). Extract key insights, decisions, code patterns, or solutions. Preserve important details.",
  "tags": ["tag1", "tag2", "tag3"]
}`;
