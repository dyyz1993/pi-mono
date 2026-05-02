# Auto-Memory Source Restoration Plan

## Target Architecture
- 6 pi.on() event handlers (automatic prefetch/extract/dream)
- Extraction/Dream/Prefetch use callLLM → JSON (NOT tools)
- ONE tool: 主动记忆 (agent proactively saves)
- ONE channel: "memory" (user bookmark + file listing)
- Rich appendEntry data at each stage
- Channel sends "memory_updated" events for UI refresh

## Phase 1: Write Missing Tests (TDD)
Status: PENDING

### 1a. Test: session_start via autoMemoryExtensionDefault
- File: auto-memory.test.ts
- Test that autoMemoryExtensionDefault(pi) registers session_start
- Emit session_start → verify memoryDir created + status("memory ready")

### 1b. Test: Active Memory Tool (主动记忆)
- File: auto-memory.test.ts
- Test pi.registerTool was called with the tool name
- Test tool execute: creates file in memoryDir with frontmatter
- Test tool execute: updates MEMORY.md index

### 1c. Test: Channel Bookmark (用户收藏)
- File: auto-memory.test.ts
- Test channel receives { type: "user_remember", content, sourceSessionId, sourceMessageIds }
- → calls callLLM to summarize
- → creates bookmark file with correct frontmatter (type: "bookmark", sourceSession, tags)
- → sends { type: "memory_updated", files } back through channel
- Test channel receives { type: "list" } → returns file list

### 1d. Test: Rich appendEntry data
- File: auto-memory.test.ts
- Test memory_prefetch appendEntry has { query, availableFiles }
- Test memory_prefetch_result has { selectedFiles, totalBytes, durationMs }
- Test memory_extract_result has { created, updated, skipped, durationMs }
- Test memory_dream_result has { merged, deleted, updated, indexUpdated, durationMs }

## Phase 2: Fix 3 Existing Tests
Status: PENDING

### 2a. "creates memory dir and injects system prompt"
- Currently: inline handler reimplemented
- Fix: use createMockPi() + autoMemoryExtensionDefault()

### 2b. "includes MEMORY.md content when present"
- Currently: inline handler reimplemented
- Fix: use createMockPi() + autoMemoryExtensionDefault()

### 2c. "injects prefetched memories into context messages"
- Currently: uses createHarness with inline handlers
- Fix: use createMockPi() + autoMemoryExtensionDefault()

## Phase 3: Restore Source Code
Status: PENDING

### 3a. Restore auto-memory.ts
- Keep: MemoryPrefetch, MemoryExtractor, MemoryDream classes (JSON-based, they're correct)
- Keep: BookmarkCreator class (for channel bookmark flow)
- Keep: utils.ts, prompts.ts (already correct)
- RESTORE: 6 pi.on() event handlers from original design
- ADD: pi.registerTool() for 主动记忆
- ADD: pi.registerChannel("memory") for bookmark + list
- ADD: Rich appendEntry calls with full data
- REMOVE: All tool registrations except 主动记忆 (select_memories, manage_memory, merge_memories, delete_memory, update_memory, update_memory_index are NOT needed)

### 3b. Sync deployed version
- After source is correct, copy to ~/.pi/agent/extensions/auto-memory/

## Phase 4: Run All Tests & Verify
Status: PENDING

### 4a. Mock tests
```bash
cd packages/coding-agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/auto-memory/auto-memory.test.ts test/auto-memory/utils.test.ts
```

### 4b. E2E tests (need API key)
```bash
cd packages/coding-agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/auto-memory/rpc-e2e.test.ts test/auto-memory/rpc-e2e-scenarios.test.ts test/auto-memory/rpc-e2e-errors.test.ts
```

### 4c. Error recovery tests
```bash
cd packages/coding-agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/auto-memory/rpc-e2e-errors.test.ts
```
