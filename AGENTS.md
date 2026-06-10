# Development Rules

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

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

## Commands

- After code changes (not docs): `npm run check` (full output, no tail). Fix all errors, warnings, and infos before committing. Does not run tests.
- Never run `npm run build` or `npm test` unless requested by the user.
- Never run the full vitest suite directly: it includes e2e tests that activate when endpoint/auth env vars are present. For all non-e2e tests, run `./test.sh` from the repo root. Otherwise run specific tests from the package root: `node ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`.
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts` + the faux provider. No real provider APIs, keys, or paid tokens.
- Put issue-specific regressions under `packages/coding-agent/test/suite/regressions/` named `<issue-number>-<short-slug>.test.ts`.

### Test Harness Guide

The harness (`test/suite/harness.ts`) provides a full in-memory AgentSession with a faux LLM provider. Use it for integration tests that need extension loading, event emission, or context hooks.

**Creating a harness:**

```typescript
import { createHarness, type Harness } from "./harness.ts";
import { myExtension } from "../../extensions/my-extension/index.ts";

const harnesses: Harness[] = [];
afterEach(() => harnesses.forEach(h => h.cleanup()));

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

**Key harness APIs:**

| API | Purpose |
|---|---|
| `harness.session` | The `AgentSession` instance |
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

**Three test tiers:**

1. **Unit tests** (pure functions, no harness): test individual functions directly. Fast, isolated.
2. **Harness integration tests** (faux provider): test extension loading, event hooks, context pipeline. No real API calls.
3. **Stress tests**: long-running scenarios (200+ turns, burst messages, repeated compaction cycles). Use harness with synthetic data.
- For ad-hoc scripts, `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

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
- Message format: `{feat,fix,docs}[(ai,tui,agent,coding-agent)]: <commit message> (optionally multiple lines)`. Message is informative and concise.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

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
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt (e.g. `This comment is AI-generated by `/wr``).

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

**Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases.

1. **Update CHANGELOGs**: ask the user whether they ran the `/cl` prompt on the latest commit on `main`. If not, they must run `/cl` first to audit and update each package's `[Unreleased]` section before releasing.

2. **Local smoke test**: build an unpublished release and smoke test from outside the repo (so it can't resolve workspace files):
   ```bash
   npm run release:local -- --out /tmp/pi-local-release --force
   cd /tmp

   # Node package install smoke tests
   /tmp/pi-local-release/node/pi --help
   /tmp/pi-local-release/node/pi --version
   /tmp/pi-local-release/node/pi --list-models
   /tmp/pi-local-release/node/pi -p "Say exactly: ok"
   /tmp/pi-local-release/node/pi

   # Bun binary smoke tests
   /tmp/pi-local-release/bun/pi --help
   /tmp/pi-local-release/bun/pi --version
   /tmp/pi-local-release/bun/pi --list-models
   /tmp/pi-local-release/bun/pi -p "Say exactly: ok"
   /tmp/pi-local-release/bun/pi
   ```
   Verify both Node and Bun startup, model/account listing, interactive startup, and at least one real prompt with the intended default provider. The bare commands `/tmp/pi-local-release/node/pi` and `/tmp/pi-local-release/bun/pi` start interactive mode; run each in tmux, submit a prompt, and wait for the model reply before considering the interactive smoke test passed. Failures are release blockers unless the user explicitly accepts the risk.

3. **Run the release script**:
   ```bash
   PI_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch    # fixes + additions
   PI_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:minor    # breaking changes
   ```
   Use `npm_config_min_release_age=0` only for the release command. The repo's normal npm age gate can otherwise block the release lockfile refresh when the current workspace package version was published recently. Review any lockfile or shrinkwrap diffs the release creates before push.

   The release script bumps all package versions, updates changelogs, regenerates release artifacts, runs `npm run check`, commits `Release vX.Y.Z`, tags `vX.Y.Z`, adds fresh `## [Unreleased]` changelog sections, commits `Add [Unreleased] section for next cycle`, then pushes `main` and the tag. Do not rerun the release script after a tag was pushed.

4. **CI publishes npm packages**: pushing the `vX.Y.Z` tag triggers `.github/workflows/build-binaries.yml`. The `publish-npm` job uses npm trusted publishing through GitHub Actions OIDC with environment `npm-publish`; no local `npm publish`, `npm whoami`, OTP, or WebAuthn flow is required.

5. **If CI publish fails**: inspect the failed `publish-npm` job. The publish helper is idempotent and skips package versions already present on npm, so rerun the tag workflow after fixing CI or transient npm issues. Do not rerun `npm run release:patch` or `npm run release:minor` for the same version.

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.
