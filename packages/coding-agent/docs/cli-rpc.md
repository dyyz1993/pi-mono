# CLI RPC Client

Three subcommands that let you interact with a `pi` agent process **directly
from the command line** — no Node.js scripts required.

```bash
pi rpc --method get_state              # Invoke any RPC method
pi channel call todo getTodos '{}'     # Call extension channel methods
pi subscribe                           # Stream live events as JSONL
```

---

## `pi rpc` — invoke an RPC method

Spawns a background `pi --mode rpc` child, sends one command, prints the full
response JSON to stdout, and exits.

```bash
pi rpc --method <method> [--params '<json>'] [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--method <name>` | *(required)* | RPC method (see `--list-commands`) |
| `--params '<json>'` | `{}` | JSON object merged into the command body |
| `--params-file <path>` | — | Read params from a file (`-` for stdin) |
| `--timeout <seconds>` | `30` | Wait timeout |
| `--session <id>` | — | `switch_session` first |
| `--list-commands` | — | Print all ~75 RPC methods grouped by category |
| `--pretty` | compact | Pretty-print JSON |
| `--remote-ssh <target>` | — | Run on a remote host (SSH config host) |
| `--provider <name>` | — | Provider for the child agent |
| `--model <id>` | — | Model for the child agent |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Response received (including `success: false`) |
| `1` | RPC server returned an error (`success: false`) |
| `2` | Connection / timeout / parse error |

### Examples

```bash
# Check agent state
pi rpc --method get_state | jq .

# Send a prompt (events stream — see "subscribe" below)
pi rpc --method prompt --params '{"message":"hello"}'

# List active tool definitions
pi rpc --method get_tools

# Switch session, then get messages
pi rpc --method get_messages --session "<session-id>"

# Browse all available commands
pi rpc --list-commands

# From a file (useful for large params)
cat > /tmp/params.json << 'EOF'
{"message":"Review the code","images":[]}
EOF
pi rpc --method prompt --params-file /tmp/params.json
```

### Why this exists

Before this CLI client, every RPC call required writing an import-and-invoke
script:

```ts
// The OLD way — no more!
import { RpcClient } from "@dyyz1993/pi-coding-agent";
const client = new RpcClient();
await client.start();
const state = await client.getState();
console.log(state);
await client.stop();
```

Now it is one command:

```bash
pi rpc --method get_state
```

---

## `pi channel` — invoke extension channel methods

Extension authors can expose typed `ServerChannel` contracts. `pi channel`
lets you call those methods from the terminal without writing a
`ClientChannel<T>` wrapper.

```bash
pi channel call <name> <method> '<params-json>' [options]
pi channel list
```

### Subcommands

**`call`**: Invokes a channel method via `RpcClient#channel(name).call()`.
The result is printed as JSON to stdout.

```bash
pi channel call todo getTodos '{}'
pi channel call todo addTodo '{"text":"Write docs"}'
pi channel call bash exec '{"command":"ls -la"}'
```

**`list`**: Prints the nine channels registered in the static
`ChannelTypeRegistry`. Channels actually available depend on which
extensions loaded at runtime.

```bash
pi channel list
# →
# bash
# todo
# lsp
# learning
# subagent
# coordinator
# rules-engine
# supervisor
# remote-ssh
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--timeout <seconds>` | `30` | Response wait timeout |
| `--params-file <path>` | — | Read params JSON from a file |
| `--pretty` | compact | Pretty-print JSON output |

---

## `pi subscribe` — stream live events

Opens a long-lived connection and prints every session event as JSON(L).
Use `--pretty` for readability or pipe to `jq`.

```bash
pi subscribe [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--extension <name>` | all | Only events from this extension |
| `--type <type>` | all | Only events of this type (`agent_end`, `tool_call`, …) |
| `--timeout <seconds>` | `0` (forever) | Exit after N seconds |
| `--pretty` | JSONL | Pretty-print each event |

### Examples

```bash
# Watch everything (two terminals)
pi subscribe --pretty &
pi rpc --method prompt --params '{"message":"hello"}'

# Filter to a specific extension
pi subscribe --extension todo --pretty

# Filter to a specific event type, exit after 30s
pi subscribe --type agent_end --timeout 30

# Pipe to jq for analysis
pi subscribe | jq 'select(.type == "tool_call")'
```

### How it stops

- **Ctrl+C**: tears down the child agent process and exits cleanly.
- **`--timeout`**: automatic exit after N seconds.

---

## Architecture notes

### How the child process is managed

All three commands reuse the existing [`RpcClient` SDK](../src/modes/rpc/rpc-client.ts),
which spawns a real `pi --mode rpc` child process:

```
pi rpc --method get_state
  └─ new RpcClient(options)
       └─ child_process.spawn("node dist/cli.js --mode rpc")
            └─ stdin/stdout JSONL ←→ agent session
```

The child's stdin is owned by the `RpcClient` instance, **not** forwarded
from the caller's stdin. This means:

- `echo '...' | pi rpc --method get_state` works correctly (no EOF race)
- The `rpc-mode.ts:1314` stdin-EOF → immediate-shutdown bug is bypassed

### stdin EOF workaround

The known `rpc-mode.ts:1314-1317` issue causes `echo '{"type":"get_state"}' |
pi --mode rpc` to fail because stdin closes before the response arrives.
The three CLI subcommands avoid this entirely: they let `RpcClient` own the
child's stdin pipe; the parent process's stdin is never forwarded.

### `--list-commands` is static

RPC commands have no runtime schema registry (the `handleCommand` switch in
`rpc-mode.ts:251` is pure TypeScript). The command table in
[`rpc-commands-table.ts`](../src/cli/rpc-commands-table.ts) is a hand-maintained
mirror of the `RpcCommand` union. When new commands are added upstream,
the table should be updated too.

### `pi channel list` is static

Channel names come from the compile-time [`ChannelTypeRegistry`](../src/core/extensions/channel-registry.ts),
not from a runtime query. The nine names shown are the full superset of
what any session could provide.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `"Failed to start RPC agent"` | `dist/cli.js` not built | `npm run build` |
| `"Agent process stdout ended"` | Session crashed | Try `--provider`/`--model` override |
| `Connection error 2` | Invalid `--params` JSON | Check your JSON with `jq .` |
| No output from `subscribe` | Nothing happening | Open a second terminal and send `prompt` |

### Debug flow

```bash
# 1. Verify the agent can start at all
pi rpc --method get_state

# 2. Test a channel
pi channel call todo getTodos '{}'

# 3. Stream events in a second terminal
pi subscribe --pretty

# 4. Browse all commands
pi rpc --list-commands
```
