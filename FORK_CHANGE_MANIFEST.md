# Fork Change Manifest
## pi-momo-fork since fork point `a98e087e5`

**Branch:** `feat/fork-v0.78.1`
**Scope:** `a98e087e5..HEAD`

---

## 1. Summary Statistics

| Category | Count |
|---|---|
| **Modified files** | 334 |
| **Added files** | 215 |
| **Deleted files** | 0 |
| **Renamed files** | 0 |
| **Pure package rename** (`@earendil-works` → `@dyyz1993`) | 253 |
| **Substantive modified files** | 81 |
| **Total insertions** | 52,948 |
| **Total deletions** | 1,210 |

**Verdict:** Zero deletions. The fork is purely additive. Post-merge strategy: apply fork's additions on top of upstream; no upstream removals need reconciliation.

---

## 2. Category A: Package Rename Only (253 files)

These files contain **only** `@earendil-works` → `@dyyz1993` string replacements. No logic changes. After merging upstream, re-apply the rename mechanically (search-replace).

**Groups:**

### Agent package (18 files)
- `packages/agent/README.md`
- `packages/agent/src/harness/agent-harness.ts`
- `packages/agent/src/harness/compaction/branch-summarization.ts`
- `packages/agent/src/harness/compaction/compaction.ts`
- `packages/agent/src/harness/compaction/utils.ts`
- `packages/agent/src/harness/messages.ts`
- `packages/agent/src/harness/session/session.ts`
- `packages/agent/src/harness/types.ts`
- `packages/agent/src/proxy.ts`
- `packages/agent/test/agent-loop.test.ts`
- `packages/agent/test/e2e.test.ts`
- `packages/agent/test/harness/agent-harness-stream.test.ts`
- `packages/agent/test/harness/agent-harness.test.ts`
- `packages/agent/test/harness/compaction.test.ts`
- `packages/agent/test/harness/session-test-utils.ts`
- `packages/agent/test/scratch/simple.ts`
- `packages/agent/tsconfig.build.json`

### AI package (2 files)
- `packages/ai/README.md`
- `packages/ai/src/cli.ts`

### TUI package (1 file)
- `packages/tui/README.md`

### Coding-agent docs (11 files)
- `packages/coding-agent/docs/compaction.md`
- `packages/coding-agent/docs/custom-provider.md`
- `packages/coding-agent/docs/development.md`
- `packages/coding-agent/docs/index.md`
- `packages/coding-agent/docs/json.md`
- `packages/coding-agent/docs/packages.md`
- `packages/coding-agent/docs/providers.md`
- `packages/coding-agent/docs/quickstart.md`
- `packages/coding-agent/docs/rpc.md`
- `packages/coding-agent/docs/sdk.md`
- `packages/coding-agent/docs/session-format.md`
- `packages/coding-agent/docs/termux.md`
- `packages/coding-agent/docs/tui.md`

### Coding-agent examples/extensions (52 files)
- All `packages/coding-agent/examples/extensions/*.ts` (except package.json/package-lock.json which also have version changes)
- `packages/coding-agent/examples/extensions/README.md`
- `packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts`
- `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/index.ts`
- `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/test.ts`
- `packages/coding-agent/examples/extensions/doom-overlay/*`
- `packages/coding-agent/examples/extensions/dynamic-resources/index.ts`
- `packages/coding-agent/examples/extensions/plan-mode/index.ts`
- `packages/coding-agent/examples/extensions/sandbox/index.ts`
- `packages/coding-agent/examples/extensions/subagent/*`
- `packages/coding-agent/examples/extensions/with-deps/index.ts`

### Coding-agent examples/sdk (11 files)
- `packages/coding-agent/examples/sdk/01-minimal.ts` through `13-session-runtime.ts` (except 03, 06, 07 which have substantive changes)
- `packages/coding-agent/examples/sdk/README.md`
- `packages/coding-agent/examples/rpc-extension-ui.ts`

### Coding-agent src (mostly rename, see Category B for exceptions)
- `packages/coding-agent/src/bun/register-bedrock.ts`
- `packages/coding-agent/src/cli/config-selector.ts`
- `packages/coding-agent/src/cli/file-processor.ts`
- `packages/coding-agent/src/cli/initial-message.ts`
- `packages/coding-agent/src/cli/list-models.ts`
- `packages/coding-agent/src/cli/session-picker.ts`
- `packages/coding-agent/src/core/auth-storage.ts`
- `packages/coding-agent/src/core/compaction/compaction.ts`
- `packages/coding-agent/src/core/compaction/utils.ts`
- `packages/coding-agent/src/core/export-html/index.ts`
- `packages/coding-agent/src/core/export-html/tool-renderer.ts`
- `packages/coding-agent/src/core/extensions/wrapper.ts`
- `packages/coding-agent/src/core/keybindings.ts`
- `packages/coding-agent/src/core/messages.ts`
- `packages/coding-agent/src/core/model-registry.ts`
- `packages/coding-agent/src/core/package-manager.ts`
- `packages/coding-agent/src/core/provider-attribution.ts`
- `packages/coding-agent/src/core/tools/edit.ts`
- `packages/coding-agent/src/core/tools/find.ts`
- `packages/coding-agent/src/core/tools/ls.ts`
- `packages/coding-agent/src/core/tools/read.ts`
- `packages/coding-agent/src/core/tools/render-utils.ts`
- `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`
- `packages/coding-agent/src/core/tools/write.ts`
- `packages/coding-agent/src/package-manager-cli.ts`
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`
- All 34 `packages/coding-agent/src/modes/interactive/components/*.ts` (except `oauth-selector.ts`)
- `packages/coding-agent/tsconfig.build.json` (rename only)
- `packages/coding-agent/tsconfig.examples.json`
- `packages/coding-agent/vitest.config.ts`

### Coding-agent test/suite (most are rename only)
- All `packages/coding-agent/test/*.test.ts` except: `agent-session-stats`, `args`, `bash-close-hang-windows`, `extensions-runner`, `rpc-client-process-exit`, `rpc-prompt-response-semantics`, `sdk-stream-options`, `session-manager/save-entry`, `tool-execution-component`, `tools`, `trigger-compact-extension`
- All `packages/coding-agent/test/suite/**/*.test.ts` except `4167-thinking-toggle-pending-tool-render.test.ts`
- `packages/coding-agent/test/utilities.ts`, `test-harness.ts`, `test-harness.test.ts`, `streaming-render-debug.ts`

### Config/root
- `README.md`, `tsconfig.json`
- `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/contribution.yml`
- `.pi/extensions/*`, `.pi/prompts/cl.md`
- `scripts/browser-smoke-entry.ts`, `scripts/local-release.mjs`, `scripts/publish.mjs`

---

## 3. Category B: Feature Additions (Substantive)

### 3.1 Extension Channel System

**New files:**
- `packages/coding-agent/src/core/extensions/channel-factory.ts` — `createTypedChannel()`, `defineChannel()`, `TypedChannel` type
- `packages/coding-agent/src/core/extensions/channel-manager.ts` — `ChannelManager` class
- `packages/coding-agent/src/core/extensions/channel-types.ts` — `Channel`, `ChannelDataMessage`, `ChannelEntry`, `ChannelOutputFn`
- `packages/coding-agent/src/core/extensions/client-channel.ts` — `ClientChannel` class
- `packages/coding-agent/src/core/extensions/server-channel.ts` — `ServerChannel`, `ChannelContract` type
- `packages/coding-agent/src/modes/rpc/rpc-client-types.ts` — `RpcClientAPI`, `RpcClientSurface` types

**Modified files:**

#### `packages/coding-agent/src/core/extensions/index.ts`
- **Fork changes:** Added exports for the entire channel system (channel-factory, channel-manager, channel-types, client-channel, server-channel) plus `CallLLMHandler`, `CallLLMOptions`, `UIEvent`, `UIEventResult`.
- **Change type:** Feature (new exports)
- **Must preserve:** All `export type`/`export` lines for channel classes and CallLLM/UIEvent types.

#### `packages/coding-agent/src/core/extensions/loader.ts`
- **Fork changes:** Added deferred channel registration in extension runtime: `registerChannel()` now buffers sends/handlers until a real channel is available. Added `pendingChannelRegistrations`, `resolvedChannels` to runtime. Added `deleteEntries`, `summarizeEntries`, `setToolOperationsProvider`, `getToolOperationsProvider`, `registerChannel`, `callLLM` to the notInitialized stubs.
- **Change type:** Feature
- **Must preserve:** The `runtime.registerChannel` implementation with buffered sends/handlers and deferred channel resolution.

#### `packages/coding-agent/src/core/extensions/runner.ts` (305 lines changed)
- **Fork changes:** Major expansion: (1) `wrapUIForInterception()` — wraps all `ctx.ui` methods to emit `"ui"` events that extensions can intercept and respond to remotely. (2) `setContextDirFns()` — injects project root + per-session/project/cwd/global data dir getters. (3) `setFileSnapshotManagerFn()`, `setRespondUIFn()`, `setPermissionModeFn()` — setter injection. (4) `flushPendingChannels()` / `updateRegisterChannel()` — flush deferred channel registrations. (5) Runtime now includes `deleteEntries`, `summarizeEntries`, `setToolOperationsProvider`, `getToolOperationsProvider`, `registerChannel`, `callLLM`.
- **Change type:** Feature
- **Must preserve:** All new private fields (`uiContextAvailable`, `pendingUIResponses`, `getPermissionModeFn`, `_currentExtensionName`, context dir fns, `getFileSnapshotManagerFn`, `respondUIFn`). All new methods (`setContextDirFns`, `setFileSnapshotManagerFn`, `setRespondUIFn`, `setPermissionModeFn`, `wrapUIForInterception`, `flushPendingChannels`, `updateRegisterChannel`). The `wrapUIForInterception` async race logic with `Promise.race`.

#### `packages/coding-agent/src/core/extensions/types.ts` (189 lines changed)
- **Fork changes:** Massive type additions: `UIEvent`, `UIEventResult`, `EntriesInvalidatedEvent`, `select()` options expanded (`multiple`, `toolCallId`, `hookMeta`), `CustomEditor` options, `ExtensionContext` new fields (`permissionMode`, `sessionSignal`, `extensionName`, `projectRoot`, `sessionDataDir`, `projectDataDir`, `cwdDataDir`, `globalDataDir`, `fileSnapshotManager`, `respondUI`), `ExtensionRuntime` new methods (`deleteEntries`, `summarizeEntries`, `setName`, `extensionName`), `compact()` options expanded (`skipFiles`), event handlers for `"entries_invalidated"` and `"ui"`, `message_end` with `entryId`, `tool_execution_start`/`end` with `timestamp`/`durationMs`.
- **Change type:** Feature
- **Must preserve:** All new interfaces and type extensions. These are the public extension API surface.

---

### 3.2 File Snapshot / Rollback System

**New files:**
- `packages/coding-agent/src/core/file-store/file-snapshot-manager.ts` — `FileSnapshotManager` class
- `packages/coding-agent/src/core/file-store/internal-git.ts` — `InternalGit` (git operations for snapshot baseline)
- `packages/coding-agent/src/core/file-store/index.ts` — exports (`GCResult`, `BatchDiffResult`, `FileDiffResult`, `FileHistoryResult`, `ModifiedFilesResult`)

**Modified files:**

#### `packages/coding-agent/src/core/session-manager.ts` (324 lines changed)
- **Fork changes:** (1) New entry types: `DeletionEntry` (marks entries as deleted from context), `SegmentSummaryEntry` (replaces entries with a summary), `LeafPointerEntry` (navigation pointer), `TierModelsChangeEntry`, `AgentChangeEntry`. (2) `flattenMessages()` now filters out deleted entries and replaces segment-summary targets with branch summary messages. Handles cascading deletion (assistant tool calls → tool results). (3) Deletion tracking: collects `deletedIds`, `deletedToolCallIds`, `strippedToolCallIds` to cascade-hide orphaned tool results.
- **Change type:** Feature
- **Must preserve:** All new entry interfaces, the deletion/segment-summary filtering logic in `flattenMessages()`, the cascading tool-call deletion logic.

---

### 3.3 MCP Integration

**New files:**
- `packages/coding-agent/src/core/mcp/index.ts` — barrel export
- `packages/coding-agent/src/core/mcp/mcp-manager.ts` — `McpManager` class (manages MCP server connections)
- `packages/coding-agent/src/core/mcp/types.ts` — `McpServerConfig`, `McpSettings`, `McpConnection`, `McpManagerOptions`, `McpManagerEvents`, `DiscoveredTool`
- `packages/coding-agent/src/core/mcp/tool-converter.ts` — `createMcpToolDefinition()` (converts MCP tools to pi tool format)
- `packages/coding-agent/src/core/mcp/errors.ts` — MCP error classes
- `packages/coding-agent/src/core/mcp/logger.ts` — MCP logging utility

**Modified files:**

#### `packages/coding-agent/package.json`
- **Fork changes:** Added `"@modelcontextprotocol/sdk": "1.29.0"` dependency. Added `"dist/extensions"` to `files` array. Updated `copy-assets` script to copy `extensions/*` to `dist/extensions/`.
- **Change type:** Feature
- **Must preserve:** MCP SDK dependency, extensions bundling in `copy-assets`.

#### `packages/coding-agent/src/core/settings-manager.ts`
- **Fork changes:** (1) Added `mcp?: McpSettings` to `Settings`. (2) `applyOverrides()` now accepts `scope` param ("global" | "project") and persists. (3) Added `getTierModels()`, `setTierModels()`, `getMcpSettings()`.
- **Change type:** Feature
- **Must preserve:** `scope` parameter on `applyOverrides`, `tierModels` and `mcp` settings fields, tier model getters/setters.

---

### 3.4 Agent Types / Multi-Agent Config

**New files:**
- `packages/coding-agent/src/core/agent-types.ts` — `AgentConfig` (name, description, tools, disallowedTools, permissionMode, tier, thinkingLevel, model, paths, maxTurns, effort, skills), `AgentHooks`, `AgentScope`, `AgentTier`, `PathConfig`, `discoverAgents()`, `getBuiltinAgents()`, `loadAgentsFromDir()`, `formatAgentList()`, `AgentDiscoveryResult`, `AgentMode`, `AgentHook`, `AgentHookEntry`, `AgentSource`

**Modified files:**

#### `packages/coding-agent/src/config.ts`
- **Fork changes:** (1) `PACKAGE_NAME` fallback changed to `@dyyz1993`. (2) Added `findCanonicalGitRoot()` — worktree-aware git root resolution that follows `.git` file pointers to worktree common dir.
- **Change type:** Feature (`findCanonicalGitRoot`) + Rename
- **Must preserve:** `findCanonicalGitRoot()` implementation (handles `.git` as file → worktree case).

#### `packages/coding-agent/src/core/agent-session.ts` (695 lines changed)
- **Fork changes:** THE CORE. (1) Imports `minimatch`, `FileSnapshotManager`, `InternalGit`, `McpManager`, `createMcpToolDefinition`, storage helpers, `AgentConfig`/`PathConfig` types, `Channel` type, tool operations. (2) New types: `PermissionMode`, `CallLLMOptions`, `CallLLMHandler`. (3) `buildAgentSystemPrompt()` — generates path guidance from agent config. (4) `isThinkingLevel()`, `isPermissionMode()` guards. (5) Agent session options now include `toolOperationsProvider`, `maxTurns`, `registerChannel`. (6) `message_end` event now carries `entryId`. (7) New event types: `custom_entry`, `auto_retry_end` expanded. (8) `toCallLlmMessages()` / `textFromAssistantMessage()` helpers for `callLLM`.
- **Change type:** Feature
- **Must preserve:** `PermissionMode` type, `CallLLMOptions`/`CallLLMHandler` types, `buildAgentSystemPrompt()`, all new imports (FileSnapshotManager, InternalGit, McpManager, storage, agent-types, minimatch), `toolOperationsProvider`/`maxTurns`/`registerChannel` on options, `message_end` with `entryId`.

#### `packages/coding-agent/src/core/index.ts`
- **Fork changes:** Added exports for `AgentConfig`, agent discovery functions, MCP types (`McpManager`, `McpServerConfig`, etc.), storage helpers (`ExtensionStorage`, `getCwdDataDir`, `getProjectDataDir`, etc.).
- **Change type:** Feature
- **Must preserve:** All new export lines.

#### `packages/coding-agent/src/core/agent-session-services.ts`
- **Fork changes:** Added `maxTurns` passthrough to `CreateAgentSessionOptions`.
- **Change type:** Feature
- **Must preserve:** `maxTurns` option.

#### `packages/coding-agent/src/core/agent-session-runtime.ts` (68 lines changed)
- **Fork changes:** (1) Added `import { createAgentSessionFromServices }`. (2) `resume()` now fast-paths when `targetCwd === this.cwd` (reuses services instead of recreating). (3) New `setCwd()` method — switches working directory mid-session, forks session manager if persisted, emits proper lifecycle events.
- **Change type:** Feature
- **Must preserve:** `setCwd()` method, fast-path in `resume()`.

#### `packages/coding-agent/src/core/sdk.ts`
- **Fork changes:** Added `maxTurns` to `CreateAgentSessionOptions`.
- **Change type:** Feature
- **Must preserve:** `maxTurns` field.

---

### 3.5 Tier Models / Model Aliasing

#### `packages/coding-agent/src/core/defaults.ts`
- **Fork changes:** Added `DEFAULT_TIER_ALIASES` — `{ fast: "openai-codex/gpt-5.5-codex-mini", pro: "openai-codex/gpt-5.5", max: "anthropic/claude-opus-4-8" }`.
- **Change type:** Feature
- **Must preserve:** `DEFAULT_TIER_ALIASES` constant.

#### `packages/coding-agent/src/core/model-resolver.ts` (38 lines changed)
- **Fork changes:** (1) Added `resolveModelAlias()` — resolves tier aliases (fast/pro/max) against merged DEFAULT_TIER_ALIASES + user tierModels. (2) `resolveModelScope()` now accepts `tierModels` param and resolves aliases before glob matching. (3) `resolveDefaultModel()` accepts `tierModels`, resolves alias for default model.
- **Change type:** Feature
- **Must preserve:** `resolveModelAlias()`, the `tierModels` parameter additions to `resolveModelScope()` and `resolveDefaultModel()`.

#### `packages/ai/src/models.ts`
- **Fork changes:** Added `supportsXhigh()` — checks if a model supports xhigh thinking level (gpt-5.2/5.3/5.4, opus-4-6/4.6/4-7/4.7).
- **Change type:** Feature
- **Must preserve:** `supportsXhigh()` function.

---

### 3.6 RPC Protocol Expansion

#### `packages/coding-agent/src/modes/rpc/rpc-types.ts` (426 lines changed)
- **Fork changes:** Added 40+ new RPC command types:
  - **Session navigation:** `navigate_tree`, `rollback_preview`, `delete_entries`, `summarize_entries`, `get_full_messages`, `get_tree`, `get_tree_with_leaf`
  - **File operations:** `get_modified_files`, `get_file_diff`, `get_batch_diffs`, `get_file_history`
  - **Resources:** `get_skills`, `get_extensions`, `get_tools`
  - **Settings:** `get_settings`, `set_settings` (with scope)
  - **Context:** `get_context_usage`, `get_system_prompt`
  - **Tools:** `get_active_tools`, `set_active_tools`
  - **Queue:** `get_queue`, `clear_queue`
  - **Flags:** `get_flags`, `get_flag_values`, `set_flag`
  - **Reload:** `reload`
  - **Working dir:** `set_cwd`
  - **Agents:** `get_agents_files`, `get_agents`, `switch_agent`, `get_current_agent`, `get_latest_agent_change`, `get_agent_detail`, `get_all_tools`
  - **Permission:** `set_permission_mode`
  - **Tier models:** `get_tier_models`, `set_tier_models`
  - **MCP:** `get_mcp_servers`, `mcp_toggle_server`, `mcp_restart_server`
  - **Remote tools:** `register_remote_tool`, `unregister_remote_tool`, `remote_tool_result`
  - **Fork:** `fork` now accepts `position?: "before" | "at"`
  - **Skill type:** `RpcSkill` interface
- **Change type:** Feature
- **Must preserve:** All new command union members. This is the RPC API contract.

#### `packages/coding-agent/src/modes/rpc/rpc-client.ts` (530 lines changed)
- **Fork changes:** (1) New result types: `TreeWithLeaf`, `RollbackPreviewResult`, `ModifiedFilesResult`, `FileDiffResult`, `BatchDiffResult`, `FileHistoryResult`. (2) Added `channelHandlers` map for extension channel routing. (3) Added `readyResolve`/`readyReject` promise pattern — replaces the old `setTimeout(resolve, 100)` with a proper ready handshake. (4) `getTierModels()` client method.
- **Change type:** Feature + Fix (ready handshake)
- **Must preserve:** All new result interfaces, channel handler infrastructure, `waitForReady()` promise.

#### `packages/coding-agent/src/modes/rpc/rpc-mode.ts` (706 lines changed)
- **Fork changes:** (1) Imports `ChannelManager`, `AgentConfig`, `PermissionMode`, `discoverAgents`, `generateSegmentSummary`, `createBranchSummaryMessage`, `resolveModelAlias`, session entry types. (2) `PERMISSION_MODES` constant + `isPermissionMode()` guard. (3) `getTreeEntryLabel()`, `toTreeEntry()`, entry type guards (`isSessionMessageEntry`, `isCustomEntry`, `isCompactionEntry`). (4) `ChannelManager` instantiated and wired to output. (5) `pendingRemoteToolResults` map for async remote tool responses. (6) UI event cleanup now emits reason ("responded"/"timeout"/"aborted"). (7) `extension_ui_resolved` output event. (8) Extension context now populated with `sessionSignal`, `extensionName`, `projectRoot`, all data dirs, `fileSnapshotManager`, `respondUI`. (9) `resolveModelScope` calls now pass `tierModels`.
- **Change type:** Feature
- **Must preserve:** All new imports, `ChannelManager` instantiation, `PERMISSION_MODES`, entry type guards, `pendingRemoteToolResults`, UI cleanup reason emission, full extension context population.

#### `packages/coding-agent/src/modes/print-mode.ts` (77 lines changed)
- **Fork changes:** (1) Added `outputSchema` support via `validateStructuredOutput()`. (2) `runStructuredOutput()` — prompts model with schema, validates response, retries up to 3 times. (3) `MAX_STRUCTURED_RETRIES` constant. (4) `getLastAssistantText()` helper. (5) `--output-schema` integration in print mode flow.
- **Change type:** Feature
- **Must preserve:** `runStructuredOutput()`, `outputSchema` option, structured output validation loop.

#### `packages/coding-agent/src/modes/index.ts`
- **Fork changes:** Added `outputSchema?: TSchema` to mode options.
- **Change type:** Feature
- **Must preserve:** `outputSchema` field.

#### `packages/coding-agent/src/cli/args.ts`
- **Fork changes:** (1) Added `--output-schema <json|file>` CLI arg → `outputSchema` option + auto-enables print mode. (2) Added `--max-turns <n>` CLI arg → `maxTurns` option with validation.
- **Change type:** Feature
- **Must preserve:** Both new arg parsers and their help text.

---

### 3.7 Storage / Data Directories

**New file:**
- `packages/coding-agent/src/core/storage.ts` — `ExtensionStorage`, `getCwdDataDir()`, `getGlobalDataDir()`, `getProjectDataDir()`, `getSessionDataDir()`, `resolveProjectIdentity()`, `resolveProjectRoot()`, `encodeProjectPath()`, `StoragePaths` type

---

### 3.8 Structured Output Utils

**New files:**
- `packages/coding-agent/src/utils/structured-output.ts` — `resolveSchema()` (loads from JSON string or file), `validateStructuredOutput()` (validates against TSchema)
- `packages/coding-agent/test/utils/structured-output.test.ts`

---

### 3.9 Tool Infrastructure

**New files:**
- `packages/coding-agent/src/core/tools/output-collector.ts` — `OutputCollector` class
- `packages/coding-agent/src/core/tools/spawn-managed.ts` — `spawnManagedProcess()`, `SpawnedProcess`, `SpawnOptions`
- `packages/coding-agent/src/core/tools/strip-markdown.ts` — `stripMarkdownCodeBlock()`

#### `packages/coding-agent/src/core/tools/index.ts` (40 lines changed)
- **Fork changes:** (1) Added `ToolOperationsProvider` interface (bash/read/write/edit/grep/find/ls operations injection). (2) Added `toolsOptionsFromProvider()` — converts provider to `ToolsOptions`. (3) All tool factories now accept `*Operations` type variants. (4) Exported `OutputCollector`, `spawnManagedProcess`, `stripMarkdownCodeBlock`, `DEFAULT_INPUT_MAX_BYTES`.
- **Change type:** Feature
- **Must preserve:** `ToolOperationsProvider`, `toolsOptionsFromProvider()`, all new exports.

#### `packages/coding-agent/src/core/tools/bash.ts` (31 lines changed)
- **Fork changes:** (1) `DEFAULT_TIMEOUT_SECONDS = 300` (5 min) — bash commands now default to a timeout. (2) `description` field is now required in the tool schema. (3) `formatBashCall()` renders description prefix. (4) Tool description expanded with timeout rules. (5) `BashOperations` type added for injection.
- **Change type:** Feature + Fix
- **Must preserve:** `DEFAULT_TIMEOUT_SECONDS`, required `description` field, `effectiveTimeout` logic.

#### `packages/coding-agent/src/core/tools/grep.ts` (148 lines changed)
- **Fork changes:** (1) Added `GrepOperations` interface with optional `search()` callback — when provided, replaces the local `rg` spawn entirely. (2) Extracted the JSON line parsing into `collectMatchLine()` reusable function. (3) Refactored the inline `spawn(rgPath, ...)` to be skippable when custom search is provided.
- **Change type:** Feature (extensibility) + Refactor
- **Must preserve:** `GrepOperations.search` option, `collectMatchLine()` extraction.

#### `packages/coding-agent/src/core/tools/truncate.ts`
- **Fork changes:** Added `DEFAULT_INPUT_MAX_BYTES = 50 * 1024` (50KB) constant.
- **Change type:** Feature
- **Must preserve:** The constant.

---

### 3.10 Segment Summarization

#### `packages/coding-agent/src/core/compaction/branch-summarization.ts` (73 lines changed)
- **Fork changes:** (1) Added `SEGMENT_SUMMARY_PROMPT` system prompt. (2) Added `generateSegmentSummary()` — takes session entries, serializes conversation, calls model via `completeSimple()` to produce a <200-word summary. (3) `SegmentSummaryResult` and `GenerateSegmentSummaryOptions` interfaces.
- **Change type:** Feature
- **Must preserve:** `generateSegmentSummary()`, `SEGMENT_SUMMARY_PROMPT`.

---

### 3.11 Agent Core Changes

#### `packages/agent/src/agent-loop.ts` (19 lines changed)
- **Fork changes:** (1) `tool_execution_start` event now includes `timestamp: startedAt`. (2) `emitToolExecutionEnd()` accepts `startedAt` param and emits `timestamp` + `durationMs` on `tool_execution_end`.
- **Change type:** Feature (timing data)
- **Must preserve:** `startedAt` capture and `timestamp`/`durationMs` emission.

#### `packages/agent/src/agent.ts`
- **Fork changes:** After `agent_end` event, auto-consumes follow-up queue: if `followUpQueue.hasItems()`, calls `this.continue()`.
- **Change type:** Fix (follow-up messages queued during agent_end handlers were lost)
- **Must preserve:** The `if (this.followUpQueue.hasItems())` auto-continue block.

#### `packages/agent/src/types.ts`
- **Fork changes:** (1) `tool_execution_start` type gains `timestamp: number`. (2) `tool_execution_end` type gains `timestamp: number` and `durationMs: number`.
- **Change type:** Feature
- **Must preserve:** Updated event type definitions.

#### `packages/agent/test/agent.test.ts` (50 lines changed)
- **Fork changes:** Added test: "auto-consumes follow-up messages queued during agent_end handlers".
- **Change type:** Test
- **Must preserve:** The new test case.

---

### 3.12 AI Package Fixes

#### `packages/ai/src/utils/node-http-proxy.ts`
- **Fork changes:** `new HttpProxyAgent(proxyUrl)` cast to `unknown as import("node:http").Agent` to fix type mismatch.
- **Change type:** Fix (type compatibility)
- **Must preserve:** The cast.

#### `packages/ai/src/models.generated.ts` / `packages/ai/src/image-models.generated.ts`
- **Fork changes:** Regenerated model list (upstream model additions). These are auto-generated; safe to re-regenerate.
- **Change type:** Auto-generated
- **Must preserve:** Can be regenerated from `scripts/generate-models.ts`.

---

### 3.13 Index / Public API Expansion

#### `packages/coding-agent/src/index.ts` (71 lines changed)
- **Fork changes:** Re-exported all new public API surface: agent types (`AgentConfig`, `AgentHook`, etc.), agent discovery functions, channel system (`Channel`, `ChannelManager`, `ChannelContract`, `TypedChannel`, `ServerChannel`, `ClientChannel`, etc.), file store types (`GCResult`, `BatchDiffResult`, `FileDiffResult`, etc.), storage helpers (`ExtensionStorage`, `getCwdDataDir`, etc.), CallLLM types, `OutputCollector`, `spawnManagedProcess`, `stripMarkdownCodeBlock`, `RpcClientAPI`, `RpcClientSurface`, `TreeWithLeaf`, `RollbackPreviewResult`, `waitForChildProcess`, `killProcessTree`, `sanitizeBinaryOutput`.
- **Change type:** Feature
- **Must preserve:** All new export statements.

#### `packages/coding-agent/src/main.ts` (13 lines changed)
- **Fork changes:** (1) Passes `tierModels` from settings to `resolveModelScope()`. (2) Passes `maxTurns` from parsed args to session options. (3) Resolves `outputSchema` via `resolveSchema()` for print mode. (4) Error type in model validation changed from `"error"` to `"warning"`.
- **Change type:** Feature + Fix
- **Must preserve:** `tierModels` passthrough, `maxTurns` passthrough, `outputSchema` resolution.

#### `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (21 lines changed)
- **Fork changes:** (1) Extension context now includes full data dir population (`sessionDataDir`, `projectDataDir`, `cwdDataDir`, `globalDataDir`, `projectRoot`, `fileSnapshotManager`, `extensionName`, `sessionSignal`, `respondUI`). (2) `resolveModelScope()` calls now pass `tierModels`.
- **Change type:** Feature
- **Must preserve:** Full extension context field population, tierModels passthrough.

#### `packages/coding-agent/src/modes/interactive/components/oauth-selector.ts`
- **Fork changes:** Minor — added `AgentMessage` import, small logic adjustment.
- **Change type:** Minor fix
- **Must preserve:** The import addition.

---

## 4. Category C: Bug Fixes

| File | Fix | Must Preserve |
|---|---|---|
| `packages/agent/src/agent.ts` | Auto-consume followUpQueue after agent_end | The `if (this.followUpQueue.hasItems())` block |
| `packages/ai/src/utils/node-http-proxy.ts` | Type cast for HttpProxyAgent → http.Agent | The `as unknown as` cast |
| `packages/coding-agent/src/modes/rpc/rpc-client.ts` | Replaced `setTimeout(resolve, 100)` with proper `waitForReady()` promise handshake | `readyResolve`/`readyReject` pattern, `waitForReady()` |
| `packages/coding-agent/src/main.ts` | Model validation error changed to warning | `"warning" as const` |
| `packages/coding-agent/src/config.ts` | Worktree-aware git root resolution (`findCanonicalGitRoot`) | The entire function |
| `packages/coding-agent/src/core/tools/bash.ts` | Default timeout prevents zombie processes | `DEFAULT_TIMEOUT_SECONDS = 300` |

---

## 5. Category D: Refactoring / Config Changes

### Build / Config

| File | Change | Must Preserve |
|---|---|---|
| `tsconfig.base.json` | `target`/`lib` ES2022 → ES2024; path aliases `@earendil-works` → `@dyyz1993`; added `@dyyz1993/pi-coding-agent` self-reference | ES2024 target, all `@dyyz1993` aliases |
| `biome.json` | Added `noTemplateCurlyInString: off`, `useLiteralKeys: off`, `noUnusedVariables: off`, `noUnusedImports: off` | The new rule overrides |
| `.gitignore` | Added patterns for compiled artifacts in src/ dirs, `.codenomad/`, `.pi/`, extension build outputs | All new ignore patterns |
| `.husky/pre-commit` | Added `check-no-js-in-src.sh` guard before checks | The script invocation |
| `scripts/check-pinned-deps.mjs` | Added `.codenomad`, `.yalc`, `.pi` to ignored dirs; prefix `@dyyz1993/pi-` | Ignored dirs, prefix |
| `scripts/check-ts-relative-imports.mjs` | Same ignored dirs + prefix update | Ignored dirs, prefix |
| `scripts/generate-coding-agent-shrinkwrap.mjs` (38 lines) | Added filesystem fallback for resolving transitive deps not in lockfile; allow `matches.length >= 1` instead of `=== 1`; construct lock entry from on-disk package.json | The filesystem fallback logic |
| `packages/coding-agent/eslint.config.js` (new) | ESLint config for extensions | New file |
| `packages/coding-agent/tsconfig.extensions.json` (new) | TS config for extensions compilation | New file |

### Version Bumps
- All 4 packages: `0.78.0` → `0.78.1`
- All `@earendil-works/*` deps → `@dyyz1993/*` in package.json

### CHANGELOGs
- `packages/agent/CHANGELOG.md` — Added `## [0.78.1] - 2026-06-03` section
- `packages/ai/CHANGELOG.md` — Added `## [0.78.1] - 2026-06-03` section
- `packages/coding-agent/CHANGELOG.md` — Added `## [0.78.1] - 2026-06-03` section
- `packages/tui/CHANGELOG.md` — Added `## [0.78.1] - 2026-06-03` section

---

## 6. New Files Inventory (215 files, grouped by purpose)

### New Extensions (packages/coding-agent/extensions/) — 19 extensions

| Extension | Files | Purpose |
|---|---|---|
| **agent-permissions** | `index.ts`, `path-checker.ts`, `__tests__/path-permissions.test.ts` | Path-based permission enforcement for agents |
| **ask-tools** | `index.ts` | Tool-based question/answer |
| **auto-memory** | `index.ts`, `contract.ts`, `prompts.ts`, `skip-rules.ts`, `utils.ts`, 4 test files | Automatic memory extraction from sessions |
| **auto-session-title** | `index.ts` | Auto-generate session titles |
| **bash-ext** | `index.ts`, `contract.ts` | Extended bash operations |
| **claude-hooks-compat** | `index.ts`, `channel-contract.ts`, `config-loader.ts`, `handler-runner.ts`, `hooks-log.ts`, `if-parser.ts`, `matcher.ts`, `stdin-builder.ts`, `types.ts` | Claude Code hooks compatibility layer |
| **compaction-manager** | `index.ts`, `config.ts`, `context-fold.ts`, `half-compaction.ts`, `microcompact.ts`, `reactive.ts`, `segment-compaction.ts`, `session-memory.ts`, `sliding-window.ts` | Advanced compaction strategies |
| **coordinator** | `index.ts`, `handler.ts`, `types.ts`, `server-proxy.test.ts`, `handler.test.ts`, `INTEGRATION.md` | Multi-agent coordination |
| **file-review** | `index.ts`, `contract.ts` | File review tool |
| **file-snapshot** | `index.ts`, `contract.ts`, `index.test.ts` | File snapshot tool (uses FileSnapshotManager) |
| **file-time-guard** | `index.ts`, `config.ts`, `README.md`, `__tests__/bash-in-place.test.ts` | Guard against stale file timestamps |
| **hooks-engine** | `index.ts`, `index.test.ts` | General-purpose hooks engine |
| **lsp** | `index.ts`, `contract.ts`, `client/file-tracker.ts`, `client/registry.ts`, `client/runtime.ts`, `client/smart-file-tracker.ts`, `config/resolver.ts`, `hooks/agent-end.ts`, `hooks/diagnostics-mode.ts`, `hooks/writethrough.ts`, `monitoring/server-metrics.ts`, `tools/lsp-tool.ts`, `utils/dependency-resolver.ts`, `utils/diagnostics-wait.ts`, `utils/idle-cleaner.ts`, `utils/lazy-activator.ts`, `utils/lsp-helpers.ts`, `utils/project-scanner.ts`, `lsp.test.ts`, `lsp-clangd-e2e.test.ts`, `diagnostics-refresh.test.ts` | Full LSP integration (diagnostics, file tracking, tools) |
| **message-bridge** | `index.ts`, `GUIDE.md` | Message bridging |
| **output-guard** | `index.ts` | Output truncation protection |
| **preview** | `index.ts` | Preview tool |
| **rules-engine** | `index.ts`, `cache.ts`, `config.ts`, `injector.ts`, `loader.ts`, `matcher.ts`, `types.ts`, `RULES-ENGINE-GUIDE.md`, `MATCH_HISTORY_RECONCILIATION.md` | Rules injection engine |
| **session-supervisor** | `index.ts`, `checker.ts`, `config.ts`, `prompts.ts`, `scheduler.ts`, `types.ts` | Session monitoring/supervision |
| **subagent-v2** | `index.ts`, `contract.ts`, `subagent-shared/` (contract.ts, index.ts, package.json, render.ts, types.ts, utils.ts), `extract-parent-todos.test.ts` | V2 subagent system |
| **todo-ext** | `index.ts`, `contract.ts` | Todo management tool |

### New Source Files (packages/coding-agent/src/)

| File | Purpose |
|---|---|
| `core/agent-types.ts` | Agent config types + discovery |
| `core/extensions/channel-factory.ts` | Typed channel creation |
| `core/extensions/channel-manager.ts` | Channel manager class |
| `core/extensions/channel-types.ts` | Channel type defs |
| `core/extensions/client-channel.ts` | Client-side channel |
| `core/extensions/server-channel.ts` | Server-side channel |
| `core/file-store/file-snapshot-manager.ts` | File snapshot manager |
| `core/file-store/internal-git.ts` | Internal git operations |
| `core/file-store/index.ts` | File store barrel export |
| `core/large-input.ts` | Large input handler |
| `core/mcp/index.ts` | MCP barrel export |
| `core/mcp/mcp-manager.ts` | MCP server manager |
| `core/mcp/types.ts` | MCP types |
| `core/mcp/tool-converter.ts` | MCP tool → pi tool converter |
| `core/mcp/errors.ts` | MCP errors |
| `core/mcp/logger.ts` | MCP logger |
| `core/storage.ts` | Data directory management |
| `core/tools/output-collector.ts` | Output collection utility |
| `core/tools/spawn-managed.ts` | Managed process spawning |
| `core/tools/strip-markdown.ts` | Markdown code block stripping |
| `modes/rpc/rpc-client-types.ts` | RPC client type definitions |
| `utils/structured-output.ts` | JSON schema structured output validation |

### New Test Files (packages/coding-agent/test/)

| File | Purpose |
|---|---|
| `call-llm.test.ts` | Tests for callLLM extension API |
| `channel-manager.test.ts` | Channel manager tests |
| `claude-hooks-compat-output.test.ts` | Claude hooks compat tests |
| `cli/args-output-schema.test.ts` | --output-schema CLI arg tests |
| `client-channel.test.ts` | Client channel tests |
| `extension-api-contract.test.ts` | Extension API contract tests |
| `extension-channels.test.ts` | Extension channel tests |
| `extensions-message-bridge.test.ts` | Message bridge tests |
| `extensions-ui-intercept.test.ts` | UI interception tests |
| `file-snapshot-manager-unit.test.ts` | File snapshot unit tests |
| `file-snapshot-manager.test.ts` | File snapshot integration tests |
| `output-guard-truncation.test.ts` | Output guard tests |
| `suite/agent-session-message-entry-id.test.ts` | message_end entryId tests |
| `suite/custom-entry-event.test.ts` | custom_entry event tests |
| `suite/regressions/rollback-navigation-safety.test.ts` | Rollback safety regression |
| `utils/structured-output.test.ts` | Structured output tests |

### New Docs

| File | Purpose |
|---|---|
| `docs/fork-feature-inventory.md` | Fork feature documentation |
| `docs/fork-rpc-verification.md` | RPC verification notes |
| `docs/rpc-architecture-map.html` | RPC architecture diagram |
| `docs/rpc-protocol-reference.md` | RPC protocol reference |
| `docs/rpc-commands-*.md` (8 files) | Per-domain RPC command docs |
| `docs/rpc-data-guide.md` | RPC data guide |
| `docs/rpc-events.md` | RPC events reference |
| `docs/rpc-session-manager.md` | Session manager RPC docs |
| `docs/rpc-extension-lsp.md` | LSP extension docs |
| `docs/rpc-extension-ui.md` | UI extension docs |
| `docs/server-client-channel-guide.md` | Channel guide |
| `docs/rpc-client-api.md` / `docs/rpc-client-guide.md` | Client API docs |
| `docs/mcp-embed-plan.md` | MCP embed plan |
| `docs/rollback-rpc-verification.md` | Rollback RPC verification |
| `docs/uuid-cross-env-fix.md` | UUID cross-env fix docs |
| `docs/extension-verification-report.md` | Extension verification report |
| `docs/extensions/coordinator-and-subagent-v2-guide.md` | Multi-agent guide |
| `packages/coding-agent/docs/rollback-architecture.md` | Rollback design |
| `packages/coding-agent/docs/rollback-test-cases.md` | Rollback test cases |
| `packages/coding-agent/docs/file-rollback-design.md` | File rollback design |
| `packages/coding-agent/RPC_TYPES_EXPORT.md` | RPC types export ref |
| `analysis-model-layering.md` | Model layering analysis |
| `analysis-summary.md` | Analysis summary |
| `model-roles-implementation.md` | Model roles implementation |
| `quick-reference.md` | Quick reference |

### New Config / Scripts / CI

| File | Purpose |
|---|---|
| `.claude/rules/pi-extension-dev.mdc` | Extension dev rule |
| `.claude/rules/test-quality-guard.mdc` | Test quality rule |
| `.github/workflows/publish-packages.yml` | Publish CI workflow |
| `.husky/pre-push` | Pre-push hook |
| `.pi/settings.json` | Pi settings |
| `config/mcporter.json` | MCP porter config |
| `packages/coding-agent/.claude/settings.json` | Coding-agent Claude settings |
| `packages/coding-agent/eslint.config.js` | Extensions ESLint config |
| `packages/coding-agent/tsconfig.extensions.json` | Extensions TS config |
| `scripts/check-extension-imports.sh` | Extension import checker |
| `scripts/check-no-js-in-src.sh` | Block stale .js files |
| `scripts/kb-batch-update.mjs` | KB batch update |
| `scripts/kb-list.mjs` | KB list |
| `scripts/kb-read-key.mjs` | KB read key |
| `scripts/kb-update-extensions.mjs` | KB update extensions |
| `version.txt` | Version file |
| `worktree-multi-ip-test.sh` | Multi-worktree test script |

### New UI Tester Knowledge (`.ui-tester/knowledge/`)
- `chat/patterns.yml`, `chat/selectors.yml`, `chat/sessions/2026-05-24.md`
- `rollback/patterns.yml`, `rollback/selectors.yml`, 13 session files under `rollback/sessions/`

---

## 7. Post-Merge Verification Checklist

### Critical (will break if missing)
- [ ] Package rename applied (`@earendil-works` → `@dyyz1993`) across all 253 files
- [ ] All 22 new source files exist and compile
- [ ] `extensions/types.ts` — all new interfaces present (`UIEvent`, `UIEventResult`, `EntriesInvalidatedEvent`, extended `ExtensionContext`)
- [ ] `extensions/runner.ts` — `wrapUIForInterception()`, `setContextDirFns()`, `flushPendingChannels()`, all setter injections
- [ ] `agent-session.ts` — `PermissionMode`, `CallLLMOptions`, `buildAgentSystemPrompt()`, `message_end` with `entryId`
- [ ] `session-manager.ts` — `DeletionEntry`, `SegmentSummaryEntry`, `LeafPointerEntry`, deletion/segment filtering in `flattenMessages()`
- [ ] `rpc-types.ts` — all 40+ new command types
- [ ] `rpc-mode.ts` — `ChannelManager`, entry type guards, `pendingRemoteToolResults`, full extension context
- [ ] `rpc-client.ts` — `waitForReady()`, new result types
- [ ] `model-resolver.ts` — `resolveModelAlias()`, `tierModels` params
- [ ] `defaults.ts` — `DEFAULT_TIER_ALIASES`
- [ ] `tools/index.ts` — `ToolOperationsProvider`, `toolsOptionsFromProvider()`
- [ ] `bash.ts` — `DEFAULT_TIMEOUT_SECONDS`, required `description` field
- [ ] `grep.ts` — `GrepOperations.search` callback
- [ ] `config.ts` — `findCanonicalGitRoot()`
- [ ] `storage.ts` — all data dir functions
- [ ] `mcp/` — all 6 files
- [ ] `file-store/` — all 3 files
- [ ] `extensions/channel-*.ts` — all 5 new files
- [ ] `package.json` — MCP SDK dependency, `copy-assets` with extensions

### Important (feature regressions if missing)
- [ ] `agent.ts` — followUpQueue auto-consume
- [ ] `agent-loop.ts` — timestamp + durationMs on tool events
- [ ] `agent/types.ts` — updated event types
- [ ] `print-mode.ts` — `runStructuredOutput()`, `outputSchema`
- [ ] `args.ts` — `--output-schema`, `--max-turns`
- [ ] `branch-summarization.ts` — `generateSegmentSummary()`
- [ ] `settings-manager.ts` — `scope` param, tier model getters, MCP settings
- [ ] `agent-session-runtime.ts` — `setCwd()`, fast-path resume
- [ ] `index.ts` — all new re-exports
- [ ] `interactive-mode.ts` — full extension context population

### Extensions (20 new, must all exist)
- [ ] agent-permissions, ask-tools, auto-memory, auto-session-title, bash-ext
- [ ] claude-hooks-compat, compaction-manager, coordinator
- [ ] file-review, file-snapshot, file-time-guard, hooks-engine
- [ ] lsp (largest, 21 files), message-bridge, output-guard, preview
- [ ] rules-engine, session-supervisor, subagent-v2, todo-ext
