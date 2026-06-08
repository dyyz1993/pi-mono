# Context Compaction Redesign: Multi-Pass Compression

## Problem

Current compaction is a single-pass lossy compression:

```
[entire conversation] → LLM → [one paragraph summary]
```

The LLM faces a "token budget" squeeze — it discards specific code, file paths, line numbers, config values, and key decisions, keeping only high-level descriptions. After compaction, the agent loses traceable details and must repeatedly query session logs to recover information.

**Root cause**: A single LLM call cannot simultaneously preserve all information types (code, config, decisions, state) across a long conversation. Attention is spread too thin.

## Design Goals

1. **Preserve traceable details** — file paths, line numbers, function names, config values survive compaction
2. **Structured output** — not a wall of text, but indexed sections the agent can reference
3. **No data loss risk** — disk session logs are never modified; compaction only affects in-memory context window
4. **Adaptive cost** — short conversations use cheap single-pass; long ones use multi-pass

## Proposed Architecture: Two-Layer Compaction

```
Layer 1: Segment Compression (vertical split by time)
  Conversation history
    ├─ Segment 1 (oldest)     → detailed summary 1
    ├─ Segment 2              → detailed summary 2 (with summary 1 as preamble)
    ├─ Segment 3              → detailed summary 3 (with summary 2 as preamble)
    └─ Segment 4 (newest)     → detailed summary 4 (with summary 3 as preamble)

Layer 2: Entity Index Extraction (horizontal split by type)
  summaries 1-4
    ├─ CodeExtractor    → file list + line numbers + change descriptions
    ├─ DecisionExtractor → decisions made + rationale + rejected alternatives
    ├─ StateExtractor   → done / in-progress / blocked items
    └─ ConfigExtractor  → env vars, keys, versions, paths

Final compacted context = [Entity Index] + [Segment Summaries 1-4]
```

### Layer 1: Segment Compression (Rolling Summaries)

**Purpose**: Each segment is small enough that the LLM has ample token budget to preserve specifics (function names, line numbers, config values).

**Segmentation strategy**: Split by token budget, not message count. Target ~4-8K tokens per segment. Boundaries prefer user message starts (natural conversation turns).

**Rolling context**: Each segment's compression receives the previous segment's summary as a preamble. This prevents:
- Redundant descriptions (segment 2 knows segment 1 already covered X)
- Lost causal links (segment 2 knows WHY something was decided in segment 1)

**Parallelization option**: Segments can be compressed in parallel if the rolling context is sacrificed. Trade-off:
- Sequential (with preamble): ~N × compression_time, better coherence
- Parallel (independent): ~1 × compression_time, may have redundancy across segments

**Recommendation**: Sequential for coherence. The time cost is acceptable since compaction is already a blocking operation that users wait for.

### Layer 2: Entity Index Extraction

**Purpose**: A cross-segment structured index that gives the agent immediate lookup capability without reading full summaries.

**Run after Layer 1 completes**, using all segment summaries as input.

| Extractor | Responsibility | Output Format |
|-----------|---------------|---------------|
| CodeExtractor | Function signatures, file paths, line numbers, diff highlights | `path:line — what changed` |
| DecisionExtractor | Technical decisions, rationale, rejected alternatives | `decision: rationale (rejected: X)` |
| StateExtractor | Done items, in-progress tasks, blockers, next steps | `[x] done / [ ] in-progress / [!] blocked` |
| ConfigExtractor | Environment variables, API keys referenced, versions, paths | `key = value (source: segment N)` |

**Each extractor is a separate LLM call** with a specialized system prompt. This ensures focused attention — one extractor doesn't waste budget on information another extractor handles.

**Parallelization**: All 4 extractors run in parallel (they read the same input, produce independent output). Total time ≈ 1 × extraction call.

## Final Output Structure

```
## Entity Index

### Files Modified
- packages/coding-agent/extensions/output-guard/index.ts:70 — HEAD_RATIO constant added
- packages/coding-agent/extensions/output-guard/index.ts:124 — collectLinesBudget() function
- packages/coding-agent/extensions/output-guard/index.ts:194 — saveFullOutput() path changed to /tmp/

### Key Decisions
- Head+tail (70/30) over tail-only: better LLM context understanding (rejected: head-only, equal split)
- /tmp/<slug>/ over sessionDataDir: keep temp files out of session data (rejected: sessionDataDir)
- .txt over .log: tool output, not server logs

### Current State
- [x] output-guard head+tail truncation implemented and tested
- [x] docs/fork-feature-inventory.md created
- [x] docs/upstream-merge-plan.md created
- [ ] upstream merge execution (Phase 1-7)
- [!] output-guard changes were lost by 17aa1955e — re-applied, verify persisted

### Config & Environment
- Branch: feat/fork-v0.78.1
- Fork point: a98e087e5
- Upstream HEAD: 89a92207f
- Overflow path: /tmp/<project-slug>/tool-output/output-<ts>-<rand>.txt

## Segment Summaries

### Segment 1 (earliest)
[detailed summary with specifics preserved]

### Segment 2
[detailed summary with specifics preserved]

### Segment 3
[detailed summary with specifics preserved]

### Segment 4 (most recent)
[detailed summary with specifics preserved]
```

## Adaptive Trigger

```typescript
function selectCompactionStrategy(tokenCount: number): CompactionStrategy {
  if (tokenCount < THRESHOLD_SINGLE) {
    // Short conversation: single-pass is sufficient
    return "single-pass";
  }
  if (tokenCount < THRESHOLD_MULTI) {
    // Medium: segment compression only, skip entity index
    return "segment-only";
  }
  // Long: full two-layer
  return "two-layer";
}
```

Suggested thresholds:
- `THRESHOLD_SINGLE`: ~30K tokens (current single-pass works fine here)
- `THRESHOLD_MULTI`: ~80K tokens (segment compression needed, entity index optional)

## Token Cost Analysis

| Strategy | LLM Calls | Estimated Tokens | Time | Detail Preservation |
|----------|-----------|-----------------|------|---------------------|
| Single-pass (current) | 1 | ~4K output | ~15s | Low — high-level only |
| Segment-only (4 segments) | 4 | ~12K output | ~60s | Medium — specifics per segment |
| Two-layer (4 segments + 4 extractors) | 8 | ~16K output | ~75s* | High — indexed + specifics |

*Two-layer time assumes Layer 2 runs in parallel (4 extractors simultaneously after Layer 1 completes).

**Trade-off**: Two-layer costs ~4x the tokens and ~5x the time of single-pass. But it eliminates the "what did we change again?" round-trips that each cost ~2K tokens and ~10s. For long sessions, it pays for itself within 3-4 follow-up queries.

## Data Safety

- **Disk session logs are never modified** — compaction only replaces the in-memory context window
- If compaction produces poor results, the agent can always `read` session log files to recover
- This makes aggressive multi-pass compaction safe — no risk of permanent data loss
- The entity index reduces the NEED to read logs, but the capability remains as fallback

## Implementation Notes (pi-mono)

### Current compaction flow
```
agent-loop detects token overflow
  → calls compactContext()
  → sends entire conversation to LLM with compaction prompt
  → replaces context with LLM response
```

### Required changes

1. **Segment splitter**: Function to divide conversation history into token-budgeted segments at user-message boundaries
2. **Sequential segment compressor**: Loop that compresses each segment with rolling preamble
3. **Parallel entity extractors**: 4 concurrent LLM calls with specialized system prompts
4. **Output assembler**: Combines entity index + segment summaries into final context string
5. **Adaptive router**: Chooses strategy based on token count

### Estimated code change
- New file: `src/core/compaction-v2.ts` (~200-300 lines)
- Modified: `agent-loop.ts` compaction trigger (~20 lines to call new strategy)
- New test: `test/compaction-v2.test.ts`

### Parallelism concern
pi-mono's compaction is currently synchronous (blocking). Multi-pass requires either:
- **Option A**: Sequential calls (simpler, slower, no concurrency issues)
- **Option B**: Parallel calls via Promise.all (faster, need to ensure LLM client supports concurrent requests)

Recommendation: Start with Option A (sequential), optimize to Option B later if time cost is problematic.

## Future Enhancements

1. **Incremental compaction**: Only re-compress the newest segment on each overflow, keep previous segments cached
2. **Entity index persistence**: Write the entity index to a file (e.g., `.pi/compaction-index.md`) so it survives session restarts
3. **Cross-session index**: Maintain a running entity index across multiple compaction cycles
4. **Embedding-based retrieval**: Instead of linear segment summaries, embed key facts and retrieve on-demand via similarity search
