# Development Rules

> **本文件路径：** [`AGENTS.md`](AGENTS.md)（项目根目录）
>
> 这是项目的开发规范主文件。在必要时，可以往这里面追加新的规范条目。请保持追加内容**简要**：以简短的规则描述、大纲、以及相关文件的**相对路径**为主，避免冗长说明。

## Project Architecture

```
packages/
  ai/          # LLM toolkit: providers, streaming, model definitions
  tui/         # Terminal UI (ink-based)
  agent/       # Agent orchestration framework
  coding-agent/ # Main CLI + interactive agent
    src/core/  # Session, tools, extensions, permissions
    extensions/ # Built-in extensions (agent-permissions, subagent-v2, etc.)
    test/      # Unit tests
    test/suite/ # Integration tests (harness-based)
```

**Key packages:**
- `@dyyz1993/pi-agent-core`: Agent loop, tool dispatch, message types
- `@dyyz1993/pi-ai`: Provider registry, streaming, model metadata
- `@dyyz1993/pi-tui`: Terminal UI components
- `@dyyz1993/pi-coding-agent`: The `pi` CLI binary

**Core permission system** (`packages/coding-agent/src/core/permissions.ts`):
Enforces `AgentConfig.permissionMode`, `tools` (allowlist), `disallowedTools` (blocklist with input globs), and `paths` (read/write glob constraints) in `beforeToolCall`. Works independently of the `agent-permissions` extension. See `docs/security.md#sub-agent-permission-gating`.

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.
- **Respond in the same language as the user's latest message** (e.g., Chinese → Chinese, English → English).

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/coding-agent/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` so they stay configurable.
- Never modify `packages/ai/src/models.generated.ts` directly; update `packages/ai/scripts/generate-models.ts` instead, then regenerate. Including the resulting `models.generated.ts` diff is always OK, even if regeneration includes unrelated upstream model metadata changes.

## Design Principles

### Deterministic data sources -- no guessing

Every data retrieval path must have a predictable, deterministic source:

| Data | Source | Reason |
|---|---|---|
| `oldContent` (file diff) | Snapshot tree | Immutable, consistent, never "busy" |
| `newContent` (file diff) | Disk (`readFileSync`) | Always reflects current filesystem state |

No fallback logic that tries to "guess" missing data. If the caller does not provide a baseline (`fromEntryId` or `fromHash`), `oldContent` comes from `sessionStartTreeHash` (possibly `null` -- a valid deterministic result).

### Read only what you need

- `readTree(hash)` -- reads ALL file contents (O(N) disk IO)
- `readTreeFiles(hash, wanted)` -- reads ONLY requested files (O(M) disk IO)
- `listTreeFiles(hash)` -- path+hash metadata only (0 content IO)

Use the narrowest API. If you only need paths, use `listTreeFiles`. If you need specific file contents, use `readTreeFiles`.

### newContent always from disk

- `getBatchFileContents` reads `newContent` via `readDiskFile(cwd, filePath)`
- Not from the committed snapshot tree (`toHash`)
- Eliminates the "snapshot is stale" problem entirely
- No need for "busy agent detection" or "live-change merging" workarounds

For more detail, see `docs/file-store-performance.md`.

## Commands

- After code changes (not docs): `npm run check` (full output, no tail). Fix all errors, warnings, and infos before committing. Does not run tests.
- Never run `npm run build` or `npm test` unless requested by the user.
- **yalc push 必须先 build**：推送包到消费项目前，必须先在对应 package 目录运行 `npm run build`（或从根目录 `npm run build`），确保 `dist/` 是最新的。yalc push 推的是磁盘上的文件，不包含 TypeScript 源码编译产物。流程：`npm run build && yalc push`。
- `yalc push` 到 `pi-agent-chat` 后，新创建的 Agent 进程会读取更新后的 `packages/coding-agent/dist/`；已经运行中的 Agent/CLI 进程需要 reload、停止后重启 session，或重启消费项目 dev server 才会加载新的 extension 代码。
- **Test commands:**
  - Full non-e2e suite: `./test.sh` from repo root (strips API keys to avoid e2e activation).
  - Single test file: `node ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts` from the package root.
  - After creating or modifying a test file, run it and iterate on test or implementation until it passes.
- For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts` + the faux provider. No real provider APIs, keys, or paid tokens.
- Put issue-specific regressions under `packages/coding-agent/test/suite/regressions/` named `<issue-number>-<short-slug>.test.ts`.
- For ad-hoc scripts, write them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

### Test Harness Guide

The harness (`test/suite/harness.ts`) provides a full in-memory AgentSession with a faux LLM provider. Use it for integration tests that need extension loading, event emission, or context hooks.

**Creating a harness:**

```typescript
import { createHarness, type Harness } from "./harness.ts";
import { myExtension } from "../../extensions/my-extension/index.ts";

const harnesses: Harness[] = [];
afterEach(() => harnesses.forEach((h) => h.cleanup()));

it("does something", async () => {
  const harness = await createHarness({
    extensionFactories: [myExtension],
  });
  harnesses.push(harness);

  // Access the faux provider to control LLM responses
  harness.setResponses([{ type: "text", text: "ok" }]);

  // Access session internals
  const model = harness.getModel();
  const runner = harness.session["_extensionRunner"];

  // Seed messages via sessionManager
  harness.sessionManager.appendMessage({ role: "user", content: [...], timestamp: Date.now() });

  // Emit extension events
  await runner.emit({ type: "turn_end", turnIndex: 0, message: {...}, toolResults: [] });

  // Assert on entries
  const entries = harness.sessionManager.getEntries();
  // Assert on events
  const events = harness.eventsOfType("session_compact");
});
```

**Testing agent config and permissions:**

```typescript
import type { AgentConfig } from "../../src/core/agent-types.ts";

it("enforces agent permission mode", async () => {
  const harness = await createHarness({ tools: [readTool, editTool] });
  harnesses.push(harness);

  const config: AgentConfig = {
    name: "read-only",
    description: "Read-only agent",
    permissionMode: "normal",
    tools: ["read", "grep"],
  };
  harness.session.applyAgentConfig(config);

  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("edit", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  await harness.session.prompt("edit something");
  // edit should be blocked by core permission check
});
```

**Testing interactive UI tools (`ask-user-question`, `ask-notify`):**

The `ask-tools` extension now exposes Ask v2 tools. Use `ask-user-question` for structured questions and `ask-notify` for fire-and-forget notifications. Do not add new code that calls the old `ask-confirm`, `ask-select`, `ask-input`, or `ask-editor` tool names. In harness mode, the default `noOpUIContext` returns no response for user questions. To simulate specific user responses, inject a mock UI context via `extensionRunner.setUIContext()`:

```typescript
harness.session.extensionRunner.setUIContext({
  askUserQuestion: async () => ({
    action: "responded",
    answers: {
      scope: { selected: ["Local"], text: "ship local first" },
    },
  }),
  notify: () => {},                    // non-blocking, fire-and-forget
  // Required no-op stubs for remaining ExtensionUIContext methods:
  onTerminalInput: () => () => {},
  setStatus: () => {}, setWorkingMessage: () => {}, setWorkingVisible: () => {},
  setWorkingIndicator: () => {}, setHiddenThinkingLabel: () => {},
  setWidget: () => {}, setFooter: () => {}, setHeader: () => {}, setTitle: () => {},
  confirm: async () => false, select: async () => undefined,
  input: async () => undefined, editor: async () => undefined,
  custom: async () => undefined as never,
}, "interactive");
```

**Key harness APIs:**

| API | Purpose |
|---|---|
| `harness.session` | The `AgentSession` instance |
| `harness.session.applyAgentConfig(config)` | Apply agent config (permissions, tools, paths) |
| `harness.sessionManager` | Append/query messages and entries |
| `harness.setResponses(steps)` | Control faux LLM responses |
| `harness.getModel()` | Get the default faux model |
| `harness.eventsOfType(type)` | Get emitted session events by type |
| `harness.session["_extensionRunner"]` | Access extension runner for `emit()` |
| `harness.cleanup()` | Dispose session + temp dir (call in afterEach) |

**Testing context hooks (transformContext):**

```typescript
// Context hooks run through the agent's transformContext pipeline
const messages = [userMsg, assistantMsg, toolResultMsg];
const runner = harness.session["_extensionRunner"];
const transformed = await runner.emitContext(messages);
// Assert on transformed messages
```

**Testing session events (turn_end, session_compact, etc.):**

```typescript
await runner.emit({ type: "turn_end", turnIndex: 0, message, toolResults: [] });
await runner.emit({ type: "session_compact", summary: "...", messages: [...] });
```

**Four test tiers:**

1. **Unit tests** (pure functions, no harness): test individual functions directly. Fast, isolated. Put under `test/`.
2. **Harness integration tests** (faux provider): test extension loading, event hooks, context pipeline, agent config. Put under `test/suite/`. No real API calls.
3. **Stress tests**: long-running scenarios (200+ turns, burst messages, repeated compaction cycles). Use harness with synthetic data.
4. **Regression tests**: issue-specific fixes. Put under `test/suite/regressions/` named `<issue-number>-<short-slug>.test.ts`.

**Extension development reference:** See `docs/extensions.md` for the full extension API and `examples/extensions/` for working examples.

### Coordinator Delegation Persistence

- `packages/coding-agent/extensions/coordinator/handler.ts` owns the parent-session delegate index in `coordinator-tasks.json`.
- Delegate records are user-visible runtime state. Do not silently evict them by age from `save()`, `list()`, or `buildPrompt()`.
- Stopped/completed delegate records remain visible until explicit cleanup via `session_delegate_remove` or `session_delegate_clear_stopped`.
- If a future cleanup policy is required, it must be explicit, configurable, logged/emitted as an event, and covered by regression tests. Silent retention cleanup breaks parent Agent awareness and web reconnect/recovery behavior.

### Directory System and Storage Paths

```
os.tmpdir()/                           # System temp (auto-reclaimed on reboot)
  pi-bash-<id>.log                     # Bash output overflow
  pi-input-<uuid>.txt                  # Large input overflow
  pi-tool-results/<slug>/              # Tool-result-budget overflow
  pi-clipboard-<uuid>.<ext>            # Clipboard paste images

~/.pi/agent/                           # Global agent dir (getAgentDir())
  settings.json                        # Global settings
  auth.json                            # Auth credentials
  models.json                          # Model config
  pi-debug.log                         # Debug log
  sessions/--<encoded-cwd>--/          # Session storage
    *.jsonl                            # Session history
    data/<sessionId>/<extName>/        # Session-level extension data
  extensions/                          # Global extensions
  skills/                              # Global skills
  prompts/                             # Global prompt templates
  themes/                              # Global themes
  cache/                               # Cache directory
  tmp/extensions/                      # Extension temp files
  extensions-data/<ext>/               # Global extension data (globalDataDir)
  project-data/<enc>/<ext>/            # Project extension data (projectDataDir)
  cwd-data/<enc>/<ext>/                # CWD extension data (cwdDataDir)

<project>/.pi/                         # Project-level dir (CONFIG_DIR_NAME)
  settings.json                        # Project settings
  extensions/                          # Project extensions
  skills/                              # Project skills
  prompts/                             # Project prompts
  rules/                               # Rule files
  rules-config.json                    # Rule config
  memory/                              # Session memory

~/.agents/skills/                      # Agents protocol compat (global)
<project>/.agents/skills/              # Agents protocol compat (project)
```

**Extension DataDir API** (via `pi.storage.*` in extension context):

| API | Path | Scope | Lifetime |
|---|---|---|---|
| `sessionDataDir` | `sessions/<enc>/data/<sid>/<ext>/` | Session | Deleted with session |
| `projectDataDir` | `project-data/<enc>/<ext>/` | Project | Persistent across sessions |
| `cwdDataDir` | `cwd-data/<enc>/<ext>/` | Working directory | Persistent |
| `globalDataDir` | `extensions-data/<ext>/` | Global | Persistent across projects |

**When to use which:**

| Scenario | Use | Why |
|---|---|---|
| Bash output overflow | `os.tmpdir()` | Reclaimable, not persistent |
| Tool result overflow | `os.tmpdir()` | Reclaimable, not persistent |
| Session-scoped temp data | `sessionDataDir` | Cleaned up with session |
| Project-level cache/config | `projectDataDir` | Persistent across sessions |
| Global settings/credentials | `globalDataDir` | Persistent across projects |
| User-editable project files | `<project>/.pi/` | Visible and editable by users |

**Key config functions** (in `src/config.ts`):

- `getAgentDir()` -> `~/.pi/agent/` (override via `PI_CODING_AGENT_DIR` env var)
- `getSessionsDir()` -> `~/.pi/agent/sessions/`
- `CONFIG_DIR_NAME` -> `.pi` (project-level config dir name)
- Session dir override: `PI_CODING_AGENT_SESSION_DIR` env var or `--session-dir` CLI arg

## Dependency and Install Security

- Treat npm dep and lockfile changes as reviewed code. Direct external deps stay pinned to exact versions.
- Hydrate/update locally with `npm install --ignore-scripts`; clean/CI-style with `npm ci --ignore-scripts`. Don't run lifecycle scripts unless the user asks.
- If dep metadata changes, refresh `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.
- If `packages/coding-agent/npm-shrinkwrap.json` needs regen, run `node scripts/generate-coding-agent-shrinkwrap.mjs` (verify with `--check` or `npm run check`). New deps with lifecycle scripts require review and an explicit allowlist entry in that script; never add one silently.
- Pre-commit blocks lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1`. Don't bypass unless the user wants the lockfile change committed.

## Git

Multiple pi sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- `packages/ai/src/models.generated.ts` may always be included alongside your files.
- Message format: `{feat,fix,docs}[(scope)]: <description>`. Scopes: `ai`, `tui`, `agent`, `coding-agent`. Examples: `fix(coding-agent): enforce tool allowlist in beforeToolCall` or `docs: update test harness guide`.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.
- Do not use `git stash` to work around the above restrictions. If you need to save work, commit to a branch instead.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

See `CONTRIBUTING.md` for the contributor gate (auto-close workflows, `lgtm`/`lgtmi`, quality bar).

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When creating issues:

- Add `pkg:*` labels for affected packages (`pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:tui`); use all that apply.

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt.

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the message so merging auto-closes the issue. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.

## Testing pi Interactive Mode with tmux

Run the TUI in a controlled terminal (from the repo root):

```bash
tmux new-session -d -s pi-test -x 80 -y 24
tmux send-keys -t pi-test "./pi-test.sh" Enter
sleep 3 && tmux capture-pane -t pi-test -p     # capture after startup
tmux send-keys -t pi-test "your prompt here" Enter
tmux send-keys -t pi-test Escape               # special keys (also C-o for ctrl+o, etc.)
tmux kill-session -t pi-test
```

## Testing Skill Fork with Real LLM

End-to-end tests for the skill tool and `runSubtask()` fork mode. Requires a configured provider (check `~/.pi/agent/auth.json`). Uses `-p` (non-interactive) mode with `--skill` to preload skills.

**Setup:**

```bash
# Create test fixtures
mkdir -p /tmp/pi-e2e-test/.pi/skills/test-inline
mkdir -p /tmp/pi-e2e-test/.pi/skills/test-fork
mkdir -p /tmp/pi-e2e-test/.pi/agents

# Inline skill (no context: fork)
cat > /tmp/pi-e2e-test/.pi/skills/test-inline/SKILL.md << 'EOF'
---
name: test-inline
description: A simple inline test skill
---
You are a test assistant. When activated, respond with exactly: "INLINE_SKILL_OK"
EOF

# Fork skill (context: fork)
cat > /tmp/pi-e2e-test/.pi/skills/test-fork/SKILL.md << 'EOF'
---
name: test-fork
description: A fork test skill
context: fork
---
You are a test assistant running in a forked context. Respond with exactly: "FORK_SKILL_OK"
EOF

# Agent definition
cat > /tmp/pi-e2e-test/.pi/agents/test-reviewer.md << 'EOF'
---
name: test-reviewer
description: Test reviewer agent
systemPrompt: You are a strict reviewer. Always respond with exactly "AGENT_REVIEW_OK"
---
EOF
```

**Run tests (from repo root, after `npm run build`):**

```bash
CLI=packages/coding-agent/dist/cli.js

# D1: inline skill
cd /tmp/pi-e2e-test && $CLI --skill .pi/skills/test-inline -p "Use the test-inline skill"
# Expected: output contains INLINE_SKILL_OK

# D2: fork skill
cd /tmp/pi-e2e-test && $CLI --skill .pi/skills/test-fork -p "Use the test-fork skill"
# Expected: output contains FORK_SKILL_OK

# D3: fork skill + agent
cd /tmp/pi-e2e-test && $CLI --skill .pi/skills/test-fork -a test-reviewer -p "Review the code"
# Expected: output shows review results using the test-reviewer agent
```

**Cleanup:**

```bash
rm -rf /tmp/pi-e2e-test
```

## Changelog

Location: `packages/*/CHANGELOG.md` (one per package).

Sections under `## [Unreleased]`: `### Breaking Changes` (API changes requiring migration), `### Added`, `### Changed`, `### Fixed`, `### Removed`.

Rules:

- All new entries go under `## [Unreleased]`. Read the full section first and append to existing subsections; never duplicate them.
- Released version sections (e.g. `## [0.12.2]`) are immutable; never modify them.

Attribution:

- Internal (from issues): `Fixed foo bar ([#123](https://github.com/earendil-works/pi-mono/issues/123))`
- External contributions: `Added feature X ([#456](https://github.com/earendil-works/pi-mono/pull/456) by [@username](https://github.com/username))`

## Releasing

See `docs/releasing.md` for the full release workflow. Summary:

- **Lockstep versioning**: all packages share one version. `patch` = fixes + additions, `minor` = breaking changes.
- Run `PI_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch` (or `release:minor`).
- CI publishes via npm trusted publishing on tag push. No local `npm publish`.
- Do not rerun the release script after a tag was pushed.

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.
