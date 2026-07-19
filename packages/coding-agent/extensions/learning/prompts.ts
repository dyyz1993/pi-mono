/**
 * LLM Prompt Templates for Learning Extension.
 *
 * Copied from legacy memory/prompts.ts with minimal changes:
 * - "legacy memory" → "learning" in system prompt
 */

export const MEMORY_SYSTEM_PROMPT = (memoryContent: string): string => `# learning memory

You have a persistent memory system managed by the learning extension.
Its physical storage path is runtime-owned and may be on a different filesystem
than ordinary tools such as bash, read, write, or edit.

## Types of memory

### user — user's role, goals, preferences, knowledge
- **When to save:** When you learn about the user's role, preferences, responsibilities, or knowledge level.
- **How to use:** Tailor explanations and suggestions to the user's profile. Frame answers in terms of domain knowledge they already have.
- Avoid writing memories that could be viewed as negative judgments.

### feedback — guidance about how to approach work
- **When to save:** When the user corrects your approach OR confirms a non-obvious approach worked. Both corrections and confirmations matter — only saving corrections makes you overly cautious.
- **How to use:** Let these guide your behavior so the user doesn't need to repeat the same guidance.
- **Body structure:** Lead with the rule, then **Why:** (the reason), then **How to apply:** (when/where it kicks in).

### project — ongoing work, goals, decisions not derivable from code
- **When to save:** When you learn who is doing what, why, or by when. Convert relative dates to absolute dates (e.g. "Thursday" → "2026-03-05").
- **How to use:** Understand the broader context and motivation behind the user's request.
- **Body structure:** Lead with the fact/decision, then **Why:** (the motivation), then **How to apply:** (how this should shape suggestions).

### reference — pointers to external systems
- **When to save:** When you learn about resources in external systems (dashboards, issue trackers, Slack channels).
- **How to use:** When the user references an external system or information that may be in an external system.

### bookmark — user-bookmarked chat messages (user-managed, never auto-delete)
- Created only via the create_bookmark tool. Do not create bookmark files manually.

## What NOT to save
- Code patterns, architecture, file paths (derivable from code)
- Git history (derivable from git)
- Debug solutions (the fix is in the code)
- Anything already in CLAUDE.md or system instructions
- Ephemeral task details: in-progress work, temporary state, current conversation context
- These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* — that is the part worth keeping.

## How to save
Use the save_memory tool. Do not use write, edit, bash, or other filesystem tools
to create memory files, even if the memory directory path is visible. In SSH or
remote runtime modes, ordinary file tools may operate on a different filesystem
than the memory owner.

For feedback/project types, include Why: and How to apply: lines in the content.
MEMORY.md is updated automatically by the memory system.

## When to access
- Read memory files when you need user context or project history
- Proactively save important information you learn about the user or project
- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty. Do not apply, cite, compare against, or mention memory content.

## Before recommending from memory
A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. It may have been renamed, removed, or never merged.
- If the memory names a file path: check the file exists.
- If the memory names a function or flag: grep for it.
- "The memory says X exists" is not the same as "X exists now."
- Memory records can become stale over time. If a recalled memory conflicts with current information, trust what you observe now — and update or remove the stale memory.

## MEMORY.md
${memoryContent || "Your memory is currently empty."}`;

export const SELECT_MEMORIES_PROMPT = `你是记忆系统的文件选择器 + 关键词净化器。

## 任务 1：文件选择
根据用户查询选择相关记忆文件。
- 只选择确定有用的
- 最多 5 个
- 不确定就不选
- ⚠️ 注意 history 中 userMarkedIrrelevant=true 的条目：这些文件/查询组合已被用户确认为不相关，不要重复同样的错误选择

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

### 用户反馈净化（基于 userMarkedIrrelevant）
分析 history 中 userMarkedIrrelevant=true 的条目。
这些是用户明确标记"不相关"的 prefetch 结果：
- 如果多个不相关条目命中了同一个文件 → 该文件对这类查询无用
  → 生成 skip 规则（regex 或 contains）排除该查询模式
- 如果某类查询模式的所有结果都被标记不相关 → 该查询模式不需要记忆
  → 生成 skip 规则跳过该查询模式
- 至少需要 2 个不相关标记才能生成规则（避免单次误判）

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
user     — user's role, goals, preferences, knowledge. Save when you learn about the user's role, preferences, or knowledge level.
feedback — guidance about how to approach work (corrections AND confirmations). Save both corrections and validated approaches. Include **Why:** and **How to apply:**.
project  — ongoing work, deadlines, decisions not derivable from code. Convert relative dates to absolute. Include **Why:** and **How to apply:**.
reference — pointers to external systems (dashboards, issue trackers, channels).
bookmark — DO NOT create bookmark files via extraction. Bookmarks are user-managed only.

## What NOT to save
- Code patterns, architecture, file paths (derivable from code)
- Git history (derivable from git)
- Debug solutions (the fix is in the code)
- Anything obvious from reading the codebase
- Ephemeral task details: in-progress work, temporary state, current conversation context
- Activity logs or PR lists — ask what was surprising instead

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
): string => `You are performing a dream — a reflective pass over memory files.
Analyze all memories and determine what to consolidate.

Memory storage is runtime-owned. Use only the filenames shown below in JSON actions.

## Phase 1 — Orient
Understand the current MEMORY.md index and existing topic files.

## Phase 2 — Gather signal
Check for:
- Duplicated information across files
- Contradicted facts (old info vs new)
- Stale information (outdated deadlines, completed projects, renamed/removed files)
- Related topics that should be merged
- Memories that reference specific functions/files that may no longer exist

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

export const PURIFICATION_PROMPT = (
  markedFiles: Array<{ filename: string; content: string }>,
  existingKeywords: string[],
): string => `You analyze memory files that the user marked as "irrelevant for search".
Your job: extract concise keywords/topics so these files can be excluded from future search results.

## Files marked as irrelevant:
${markedFiles.map((f) => `### ${f.filename}\n${f.content.slice(0, 500)}`).join("\n\n")}

${existingKeywords.length > 0 ? `## Already excluded keywords:\n${existingKeywords.join(", ")}` : ""}

## Rules
- Extract 1-5 keywords per file that capture the core topic
- Keywords should be 2-20 characters, lowercase
- Prefer specific terms over generic ones (e.g. "eslint" not "lint", "docker" not "container")
- Do NOT duplicate existing keywords
- If all files share a common theme, extract that too

Respond with JSON only:
{
  "keywords": ["keyword1", "keyword2", ...]
}`;


export const DISTILL_PROMPT = (
  workflow: string,
): string => `You are the skill distillation subagent. Analyze the completed workflow
below and distill it into a reusable skill.

## Raw workflow (user request, thinking, tool calls, results, response)
${workflow}

## Your task
Extract the essential, reusable procedure from this workflow. Strip:
- Verbose thinking that explored dead-ends
- Redundant tool result output (keep only signal, not raw dumps)
- Task-specific details that won't generalize (specific file names, hardcoded values)

Preserve:
- The core sequence of operations (what was done in what order)
- Key parameters and decision points (why this approach was chosen)
- Preconditions (what must be true before running this skill)
- Verification steps (how to confirm the task succeeded)

## Output format
Respond with JSON only:
{
  "name": "kebab-case-skill-name (e.g. create-file, deploy-app, fix-tests)",
  "description": "One sentence describing when to use this skill (≤100 chars)",
  "body": "# Skill: <name>\n\n## When to use\n...\n\n## Procedure\n1. ...\n2. ...\n\n## Verification\n...",
  "shouldSkip": false
}

If the workflow is too task-specific to generalize (e.g. one-off debugging, exploratory
back-and-forth with no clear procedure), set shouldSkip=true and leave other fields empty.`;

export interface SkillPromptEntry {
	name: string;
	description: string;
	body: string;
}

/**
 * Build the skill injection section for the system prompt.
 *
 * Unlike memory (passive facts), skills are reusable workflow templates. The
 * prompt frames them as suggestions: "if the user's request matches one of
 * these, consider following this procedure."
 *
 * Bodies are truncated to control token cost; descriptions are kept verbatim
 * because they are the primary matching signal.
 */
export const SKILL_SYSTEM_PROMPT = (
	skills: SkillPromptEntry[],
	maxBodyCharsPerSkill = 1500,
	maxSkills = 8,
): string => {
	if (skills.length === 0) return "";
	const selected = skills.slice(0, maxSkills);
	const items = selected
		.map((skill, index) => {
			const truncated =
				skill.body.length > maxBodyCharsPerSkill
					? `${skill.body.slice(0, maxBodyCharsPerSkill)}...`
					: skill.body;
			return `### Skill ${index + 1}: ${skill.name}\n\n**When to use:** ${skill.description}\n\n\`\`\`markdown\n${truncated}\n\`\`\``;
		})
		.join("\n\n---\n\n");
	return `# learning skills

You have a library of reusable skill templates curated from past sessions. Each
skill captures a proven workflow (procedure + verification steps) that worked
well in a previous task.

## Available skills

${items}

## How to use skills

- **Match by description.** When the user's request matches a skill's "When to
  use" description, consider following that skill's procedure.
- **Adapt, don't copy.** Skills are templates. Adjust parameters, file paths,
  and specifics to the current task. Do not blindly replay hardcoded values.
- **Skip when not relevant.** If no skill matches, proceed normally. Do not
  force-fit a skill to an unrelated request.
- **Verify after applying.** Each skill lists verification steps — run them to
  confirm the task succeeded before declaring completion.`;
};
