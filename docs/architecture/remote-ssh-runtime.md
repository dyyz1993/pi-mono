# Remote SSH Runtime

## Goal

Remote SSH support starts as a lightweight tool-operations backend. The local app keeps the model session, UI state, permission state, project list, and extension state. The remote host only executes filesystem and shell operations for a mapped project directory.

This avoids requiring Node, Bun, Docker, or a long-running agent service on the remote machine.

## Phase 1: SSH Operations Provider

The `remote-ssh` extension installs a `ToolOperationsProvider` with SSH-backed implementations for:

- `bash`
- `read`
- `write`
- `edit`
- `ls`
- `find`
- `grep`

The extension does not change the permission runtime. Permission checks still happen locally before tools execute. If a tool is allowed, its operation is delegated to the remote host.

## Configuration

Runtime config can be session-only or explicitly persisted.

The status panel UI uses session-only configuration by default. It calls
`configure` with `persist: false`, so testing or connecting from the UI does
not write into the current project checkout.

Project-local config is still supported for explicit/manual persistence:

```json
{
  "enabled": true,
  "host": "xyz-mac",
  "remoteCwd": "/Users/xyz/project",
  "sshArgs": ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"],
  "shell": "/bin/bash"
}
```

Config path:

```text
<PROJECT_DIR>/.pi/remote-ssh.json
```

Environment overrides:

```text
PI_REMOTE_SSH_ENABLED=true
PI_REMOTE_SSH_HOST=xyz-mac
PI_REMOTE_SSH_CWD=/Users/xyz/project
PI_REMOTE_SSH_ARGS="-o BatchMode=yes -o ConnectTimeout=8"
PI_REMOTE_SSH_SHELL=/bin/bash
```

## RPC Channel

The extension registers the `remote-ssh` channel in RPC mode.

```ts
const remote = client.channel("remote-ssh");

await remote.call("configure", {
  host: "xyz-mac",
  remoteCwd: "/tmp/pi-remote-project",
  sshArgs: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"],
  shell: "/bin/bash",
  persist: false
});

await remote.call("testConnection", {});
await remote.call("smokeTest", {});
await remote.call("getStatus", {});
await remote.call("disable", { persist: true });
```

`smokeTest` verifies the operations provider without an LLM call:

- `write.mkdir`
- `write.writeFile`
- `read.readFile`
- `ls.readdir`
- `find.glob`
- `grep.search`
- `bash.exec`

## Path Mapping

Tools resolve relative paths against the local session cwd before calling operations. The SSH provider maps those local absolute paths into the remote project directory.

Example:

```text
localCwd  = /Users/xuyingzhou/Project/study-web/猴子
remoteCwd = /Users/xyz/work/猴子

write("src/a.ts")
  local resolved path:  /Users/xuyingzhou/Project/study-web/猴子/src/a.ts
  remote executed path: /Users/xyz/work/猴子/src/a.ts
```

Absolute paths outside the local project are passed through unchanged, so `/tmp/a.txt` targets remote `/tmp/a.txt`.

## State Placement

Local:

- session history
- model/provider config
- permission profile
- saved permission decisions
- project trust
- UI and extension panels

Remote:

- project files
- shell command side effects
- temporary files created by remote commands

No session history is written to the remote host in phase 1.

## Future Phases

Phase 2 can add saved remote project connection profiles under the existing project-private state directory. SSH targets, remote paths, and keys are user-private state and should not be written to repository files by default.

Phase 3 can add a remote service transport for hosts where users prefer a small authenticated daemon over raw SSH.

Phase 4 can layer execution sandboxing inside the remote host. This is separate from transport: SSH can target a normal host, a Docker container, an Apple Container, or a host that itself applies sandbox rules.
