export const MEMORY_SYSTEM_PROMPT = (memoryDir: string, memoryContent: string): string => `# auto memory

You have a persistent memory system at \`${memoryDir}\`.

## Types of memory
- user     — user's role, goals, preferences, knowledge
- feedback — guidance about how to approach work (both corrections AND confirmations)
- project  — ongoing work, deadlines, decisions not derivable from code
- reference — pointers to external systems (dashboards, issue trackers)

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

export const SELECT_MEMORIES_PROMPT = `You are selecting memories useful to an AI coding agent processing a user's query.

Given the query and a list of available memory files, return up to 5 filenames
that will be clearly useful.

- Only include memories certain to be helpful
- If unsure, do not include
- If none are relevant, return an empty list
- Prefer warnings/gotchas over usage docs for actively-used tools

Respond with JSON only:
{ "selected": ["filename1.md", "filename2.md"] }`;

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
