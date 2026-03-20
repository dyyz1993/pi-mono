# Lossless Claw Quick Start Guide

DAG-based layered abstraction system for lossless context management in LLM applications.

---

## 1. Quick Installation Checklist

### Step 1: Install Package

```bash
npm install @openclaw/lossless-claw
```

**Requirements:**
- Node.js 18+ (required for SQLite FTS5 support)
- OpenClaw v2026.3+ (peer dependency)

### Step 2: Create Configuration File

Create `openclaw.config.json` in your project root:

```json
{
  "summaryModel": "claude-sonnet-4-5-20250929",
  "summaryProvider": "anthropic",
  "maxContextTokens": 200000,
  "compressionRatio": 8,
  "dbPath": "./.openclaw/lcm.db"
}
```

### Step 3: Set Environment Variables

Create `.env` file:

```bash
# Required: Model for generating summaries
LCM_SUMMARY_MODEL=claude-sonnet-4-5-20250929

# Required: Provider for summary generation
LCM_SUMMARY_PROVIDER=anthropic

# Optional: Custom SQLite database path (default: ./.openclaw/lcm.db)
LCM_DB_PATH=./.openclaw/lcm.db

# Optional: Override config file settings
LCM_MAX_CONTEXT_TOKENS=200000
```

### Step 4: Verification Procedure

Run these 3 commands to verify installation:

```bash
# 1. Check package is installed
npm list @openclaw/lossless-claw
# Expected: @openclaw/lossless-claw@<version>

# 2. Verify SQLite FTS5 is enabled
node -e "const sqlite3 = require('better-sqlite3'); const db = new sqlite3(':memory:'); db.exec('CREATE VIRTUAL TABLE test USING fts5(content)'); console.log('FTS5: OK');"
# Expected: FTS5: OK

# 3. Test configuration loading
node -e "const config = require('./openclaw.config.json'); console.log('Config loaded:', config.summaryProvider, config.summaryModel);"
# Expected: Config loaded: <provider> <model>
```

---

## 2. Configuration Reference Card

### All Available Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `summaryModel` | string | `"claude-sonnet-4-5-20250929"` | Model ID for generating summaries |
| `summaryProvider` | string | `"anthropic"` | Provider name (anthropic, openai, google, etc.) |
| `maxContextTokens` | number | `200000` | Maximum tokens for expanded context |
| `compressionRatio` | number | `8` | Messages per summary (layer 2) |
| `dbPath` | string | `"./.openclaw/lcm.db"` | SQLite database file path |
| `enableFTS5` | boolean | `true` | Enable full-text search indexing |

### Recommended Settings by Use Case

#### Small Context (< 50K tokens)
```json
{
  "summaryModel": "claude-3-haiku-20240307",
  "summaryProvider": "anthropic",
  "maxContextTokens": 50000,
  "compressionRatio": 8
}
```
**Cost:** ~$0.05-0.10/day for typical usage

#### Medium Context (50K - 200K tokens)
```json
{
  "summaryModel": "claude-sonnet-4-5-20250929",
  "summaryProvider": "anthropic",
  "maxContextTokens": 200000,
  "compressionRatio": 8
}
```
**Cost:** ~$0.20-0.50/day for typical usage

#### Large Context (> 200K tokens)
```json
{
  "summaryModel": "claude-sonnet-4-5-20250929",
  "summaryProvider": "anthropic",
  "maxContextTokens": 500000,
  "compressionRatio": 4
}
```
**Cost:** ~$0.50-2.00/day for typical usage

### Cost Optimization Tips

1. **Use cheaper models for summaries**: Haiku for layer 2, Sonnet only for layer 3+
2. **Increase compression ratio**: Higher ratio = fewer summaries = lower cost
3. **Batch summary generation**: Generate summaries during idle periods
4. **Cache summaries**: Store summary results to avoid regeneration
5. **Monitor token usage**: Set up alerts for unexpected cost spikes

---

## 3. Tool Usage Examples

### Tool 1: `lcm_grep` - Keyword Search

**Purpose:** Search historical messages using full-text search

**When to use:** Finding specific conversations, code snippets, or decisions from past sessions

**Example:**
```bash
# Search for messages containing "database migration"
lcm_grep "database migration"

# Search with context (5 messages before/after)
lcm_grep "API endpoint" --context 5

# Search in specific date range
lcm_grep "authentication" --after "2025-01-01" --before "2025-03-01"

# Regex search
lcm_grep "error.*timeout" --regex
```

**Sample Output:**
```
[2025-02-15 14:32:01] User: We need to implement the database migration strategy
[2025-02-15 14:32:15] Assistant: I'll create a migration plan using Alembic...
[2025-02-15 14:33:02] User: The database migration should be incremental
---
Found 3 matches in 1,247 messages (0.023s)
```

---

### Tool 2: `lcm_describe` - Context Description

**Purpose:** Generate AI-powered summary of current context state

**When to use:** Understanding what topics are active, getting orientation after break, onboarding new team members

**Example:**
```bash
# Generate current context description
lcm_describe

# Describe specific topic
lcm_describe --topic "authentication system"

# Include message count
lcm_describe --verbose

# Export as markdown
lcm_describe --format markdown --output context-summary.md
```

**Sample Output:**
```
Context Summary (Generated: 2025-03-20 10:45:32)
================================================

Active Topics:
- Authentication system refactoring (47 messages, last: 2h ago)
- Database schema optimization (23 messages, last: 4h ago)
- API rate limiting implementation (15 messages, last: 1d ago)

Key Decisions:
✓ Switched from JWT to session-based auth
✓ Adopting PostgreSQL over MySQL
⚠ Rate limiting strategy pending review

Open Questions:
- Redis vs Memcached for session storage?
- Should we implement 2FA in this sprint?

Total Messages: 1,247 | Date Range: 2025-01-15 to 2025-03-20
```

---

### Tool 3: `lcm_expand` - Summary Expansion

**Purpose:** Expand summaries along DAG chain to reconstruct context (≤ maxContextTokens)

**When to use:** Preparing context for LLM calls, reconstructing conversation history, exporting for analysis

**Example:**
```bash
# Expand to maximum context tokens
lcm_expand --tokens 200000

# Expand specific topic chain
lcm_expand --topic "database migration" --tokens 50000

# Expand with raw messages included
lcm_expand --include-raw --tokens 100000

# Export to file
lcm_expand --output expanded-context.json --format json
```

**Sample Output:**
```
Expansion Complete
==================
Layers traversed: 4 (Global → Layer 3 → Layer 2 → Raw)
Summaries included: 23
Raw messages: 184
Total tokens: 198,432 / 200,000

Expansion Path:
  Global Summary (1)
    └─ Layer 3: Development (8 summaries)
        └─ Layer 2: Backend (14 summaries)
            └─ Raw Messages (184 messages)

Output written to: expanded-context.json
```

**Sample JSON Output:**
```json
{
  "metadata": {
    "expandedAt": "2025-03-20T10:45:32Z",
    "totalTokens": 198432,
    "maxTokens": 200000,
    "layersTraversed": 4
  },
  "summaries": [
    {
      "layer": 3,
      "id": "sum_l3_001",
      "content": "Backend development discussions covering authentication, database, and API design...",
      "childSummaries": ["sum_l2_004", "sum_l2_005", "sum_l2_006"],
      "timestamp": "2025-03-15T09:00:00Z"
    }
  ],
  "messages": [
    {
      "id": "msg_0001",
      "role": "user",
      "content": "Let's start working on the authentication system",
      "timestamp": "2025-03-15T09:15:00Z"
    }
  ]
}
```

---

## 4. Troubleshooting Guide

### Common Issues

#### Issue 1: "SQLite FTS5 not available"
**Symptoms:**
```
Error: FTS5 extension not loaded
```

**Solution:**
```bash
# Verify Node.js version (must be 18+)
node --version

# Rebuild sqlite3 with FTS5 support
npm rebuild better-sqlite3

# Or install with build from source
npm install better-sqlite3 --build-from-source
```

#### Issue 2: "Configuration file not found"
**Symptoms:**
```
Error: openclaw.config.json not found in project root
```

**Solution:**
```bash
# Check current directory
pwd

# Verify config exists
ls -la openclaw.config.json

# Or set explicit config path
export LCM_CONFIG_PATH=/path/to/openclaw.config.json
```

#### Issue 3: "Provider authentication failed"
**Symptoms:**
```
Error: Invalid API key for provider 'anthropic'
```

**Solution:**
```bash
# Check environment variable
echo $ANTHROPIC_API_KEY

# Test API key
curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
     https://api.anthropic.com/v1/models

# Regenerate key if needed from provider dashboard
```

#### Issue 4: "Database is locked"
**Symptoms:**
```
Error: SQLITE_BUSY: database is locked
```

**Solution:**
```bash
# Find processes using database
lsof .openclaw/lcm.db

# Kill locked processes
kill <PID>

# Or wait for lock to release (default timeout: 5000ms)
# Increase timeout in config:
# "dbLockTimeout": 30000
```

#### Issue 5: "Summary generation failed"
**Symptoms:**
```
Error: Token limit exceeded during summary generation
```

**Solution:**
```bash
# Reduce compression ratio (fewer messages per summary)
# Edit openclaw.config.json:
# "compressionRatio": 4  # was 8

# Or use smaller model for layer 2 summaries
# "summaryModel": "claude-3-haiku-20240307"
```

---

### SQLite Database Verification

#### Check Database Exists and Is Valid
```bash
# Verify database file
ls -lh .openclaw/lcm.db

# Check SQLite version
sqlite3 .openclaw/lcm.db "SELECT sqlite_version();"
# Expected: 3.x.x (with FTS5)

# Verify tables exist
sqlite3 .openclaw/lcm.db ".tables"
# Expected: messages, summaries, summary_links, fts_messages

# Check message count
sqlite3 .openclaw/lcm.db "SELECT COUNT(*) FROM messages;"
```

#### Verify FTS5 Is Enabled
```bash
# Test FTS5 virtual table
sqlite3 .openclaw/lcm.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fts%';"
# Expected: fts_messages (or similar)

# Run test search
sqlite3 .openclaw/lcm.db "SELECT COUNT(*) FROM fts_messages WHERE fts_messages MATCH 'test';"
# Expected: number (or 0 if no matches)

# Check FTS5 compilation
sqlite3 .openclaw/lcm.db "PRAGMA compile_options;" | grep FTS
# Expected: ENABLE_FTS5=1
```

#### Database Integrity Check
```bash
# Run integrity check
sqlite3 .openclaw/lcm.db "PRAGMA integrity_check;"
# Expected: ok

# Check for corruption
sqlite3 .openclaw/lcm.db "PRAGMA quick_check;"
# Expected: ok
```

---

### Debug Commands

```bash
# Enable verbose logging
export LCM_DEBUG=1
lcm_describe --verbose

# Show database statistics
sqlite3 .openclaw/lcm.db "SELECT 'Messages: ' || COUNT(*) FROM messages UNION ALL SELECT 'Summaries: ' || COUNT(*) FROM summaries;"

# Export last 10 messages for inspection
sqlite3 -json .openclaw/lcm.db "SELECT * FROM messages ORDER BY timestamp DESC LIMIT 10;"

# Profile query performance
sqlite3 .openclaw/lcm.db "EXPLAIN QUERY PLAN SELECT * FROM fts_messages WHERE fts_messages MATCH 'database';"

# Check summary chain integrity
sqlite3 .openclaw/lcm.db "SELECT COUNT(*) FROM summary_links WHERE parent_id NOT IN (SELECT id FROM summaries);"
# Expected: 0 (no orphaned links)

# Monitor real-time database activity
watch -n 1 "sqlite3 .openclaw/lcm.db 'SELECT COUNT(*) FROM messages;'"
```

---

## 5. Migration Path from Sliding Window

### What Changes Are Needed

**Good news:** Lossless Claw is designed for **zero code changes** in most cases.

#### Scenario A: Using OpenClaw Compatible Tools
**Changes required:** None

If you're already using OpenClaw v2026.3+, Lossless Claw integrates automatically when installed.

```bash
# Just install and configure
npm install @openclaw/lossless-claw
# Update config (optional)
# That's it!
```

#### Scenario B: Custom LLM Application
**Changes required:** Minimal

```typescript
// Before (sliding window)
const context = messages.slice(-100); // Last 100 messages

// After (lossless DAG)
import { LcmContext } from '@openclaw/lossless-claw';
const lcm = new LcmContext({ configPath: './openclaw.config.json' });
const context = await lcm.expand({ maxTokens: 200000 });
```

### Backward Compatibility Notes

| Feature | Compatibility | Notes |
|---------|--------------|-------|
| Existing message history | ✅ Full | All messages preserved in SQLite |
| Sliding window fallback | ✅ Supported | Can configure hybrid mode |
| Provider APIs | ✅ Full | No changes to provider integration |
| Message format | ✅ Full | Standard OpenClaw message format |
| Tool calling | ✅ Full | No changes required |

### Hybrid Mode (Gradual Migration)

Enable both sliding window and DAG during migration:

```json
{
  "mode": "hybrid",
  "slidingWindowSize": 100,
  "dagEnabled": true,
  "fallbackToSlidingWindow": true
}
```

This ensures:
- New messages are stored in both systems
- LLM calls use DAG-expanded context
- Falls back to sliding window if DAG fails
- Zero downtime during migration

### Rollback Procedure

If you need to rollback to pure sliding window:

#### Step 1: Disable DAG in Config
```json
{
  "dagEnabled": false,
  "mode": "sliding-window"
}
```

#### Step 2: Remove Package (Optional)
```bash
npm uninstall @openclaw/lossless-claw
```

#### Step 3: Preserve Data (Recommended)
```bash
# Backup SQLite database (don't delete!)
cp .openclaw/lcm.db .openclaw/lcm.db.backup

# Database can be re-imported later if needed
```

#### Step 4: Verify Rollback
```bash
# Test that sliding window works
node -e "const messages = require('./messages.json').slice(-100); console.log('Messages:', messages.length);"
# Expected: 100 (or your configured window size)
```

### Data Preservation Guarantee

**Important:** Lossless Claw **never deletes** raw messages. Even after rollback:
- All messages remain in SQLite database
- Summaries are preserved
- You can re-enable DAG at any time
- Full history is always accessible via `lcm_grep`

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│ LOSSLESS CLAW CHEAT SHEET                                   │
├─────────────────────────────────────────────────────────────┤
│ INSTALL: npm install @openclaw/lossless-claw                │
│ CONFIG:  openclaw.config.json (project root)                │
│ ENV:     .env (LCM_SUMMARY_MODEL, LCM_SUMMARY_PROVIDER)     │
├─────────────────────────────────────────────────────────────┤
│ TOOLS:                                                      │
│   lcm_grep "query"     → Search messages                    │
│   lcm_describe         → Generate context summary           │
│   lcm_expand --tokens  → Expand context for LLM            │
├─────────────────────────────────────────────────────────────┤
│ LAYERS:                                                     │
│   Layer 1: Raw messages (SQLite, permanent)                 │
│   Layer 2: Basic summaries (8 msgs → 1 sum)                 │
│   Layer 3: Higher summaries (4 sums → 1 sum)               │
│   Layer 4: Global summary (unlimited compression)           │
├─────────────────────────────────────────────────────────────┤
│ DEBUG:                                                      │
│   export LCM_DEBUG=1                                        │
│   sqlite3 .openclaw/lcm.db ".tables"                        │
│   lcm_describe --verbose                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Support & Resources

- **Documentation:** https://openclaw.dev/lossless-claw/docs
- **GitHub:** https://github.com/openclaw/lossless-claw
- **Discord:** https://discord.gg/openclaw
- **Issue Tracker:** https://github.com/openclaw/lossless-claw/issues

---

*Last updated: March 20, 2026 | Version: 1.0.0*
