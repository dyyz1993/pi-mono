# LSP Plugin Environment Variables - Complete Guide

## Overview

LSP plugins can define Language Server Protocol (LSP) servers that need environment variables for configuration. This guide explains how environment variables flow through the plugin system.

## Variable Types and Substitution Order

### 1. Built-in Plugin Variables (First Priority)

These are always available and substituted first:

```javascript
${CLAUDE_PLUGIN_ROOT}  // → Absolute path to plugin installation directory
${CLAUDE_PLUGIN_DATA}  // → Absolute path to persistent plugin data directory
```

**Example:**
```json
{
  "command": "${CLAUDE_PLUGIN_ROOT}/bin/start-server.sh",
  "env": {
    "LOG_DIR": "${CLAUDE_PLUGIN_DATA}/logs"
  }
}
```

**Automatic Injection:**
Every LSP server automatically receives these environment variables:
- `CLAUDE_PLUGIN_ROOT`: Set to the plugin's installation path
- `CLAUDE_PLUGIN_DATA`: Set to the plugin's persistent data directory

### 2. User Configuration Variables (Second Priority)

Plugins can declare user-configurable options that become available as `${user_config.KEY}`:

**Plugin Manifest:**
```json
{
  "userConfig": {
    "apiKey": {
      "type": "string",
      "title": "API Key",
      "description": "Your API key for authentication",
      "sensitive": true
    },
    "projectRoot": {
      "type": "string",
      "title": "Project Root",
      "default": "${HOME}/projects"
    },
    "debugMode": {
      "type": "boolean",
      "title": "Debug Mode",
      "default": false
    }
  },
  "lspServers": {
    "my-server": {
      "command": "my-lsp-server",
      "args": ["--api-key", "${user_config.apiKey}"],
      "env": {
        "PROJECT_ROOT": "${user_config.projectRoot}",
        "DEBUG": "${user_config.debugMode}"
      }
    }
  }
}
```

**Storage:**
- Non-sensitive values → `settings.json` → `pluginConfigs[id].options`
- Sensitive values (`sensitive: true`) → Keychain/Secure Storage → `pluginSecrets[id]`

**Loading:**
```typescript
// From pluginOptionsStorage.ts
export const loadPluginOptions = memoize((pluginId: string) => {
  const settings = getSettings_DEPRECATED()
  const nonSensitive = settings.pluginConfigs?.[pluginId]?.options ?? {}
  const storage = getSecureStorage()
  const sensitive = storage.read()?.pluginSecrets?.[pluginId] ?? {}
  return { ...nonSensitive, ...sensitive } // Secure wins on collision
})
```

### 3. System Environment Variables (Third Priority)

Standard environment variables from `process.env`:

```javascript
${PATH}                  // → process.env.PATH
${HOME}                  // → process.env.HOME
${NODE_PATH:-/usr/bin}   // → process.env.NODE_PATH or default "/usr/bin"
```

**Default Values:**
The `${VAR:-default}` syntax provides fallback values when environment variables are not set.

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Plugin Installation                                           │
│    - Plugin downloaded to: ~/.claude/plugins/name@version       │
│    - Manifest parsed (plugin.json)                              │
│    - LSP server configs validated (Zod schema)                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. User Enables Plugin                                           │
│    - If manifest.userConfig exists → prompt user for values     │
│    - Store non-sensitive → settings.json                        │
│    - Store sensitive → keychain                                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. LSP Server Activation (loadPluginLspServers)                 │
│    - Check for .lsp.json file                                   │
│    - Check manifest.lspServers field                            │
│    - Validate configs against LspServerConfigSchema             │
│    - Cache on plugin.lspServers                                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Environment Resolution (resolvePluginLspEnvironment)         │
│                                                                  │
│    For each string value in command/args/env:                   │
│                                                                  │
│    a) substitutePluginVariables()                               │
│       - ${CLAUDE_PLUGIN_ROOT} → plugin.path                     │
│       - ${CLAUDE_PLUGIN_DATA} → getPluginDataDir(source)        │
│                                                                  │
│    b) substituteUserConfigVariables()                           │
│       - ${user_config.KEY} → loadPluginOptions(id)[KEY]        │
│       - Throws if key not in schema (plugin authoring bug)      │
│                                                                  │
│    c) expandEnvVarsInString()                                   │
│       - ${VAR} → process.env.VAR                                │
│       - ${VAR:-default} → process.env.VAR or default            │
│       - Track missing vars for warnings                         │
│                                                                  │
│    d) Add built-in env vars:                                    │
│       env.CLAUDE_PLUGIN_ROOT = plugin.path                      │
│       env.CLAUDE_PLUGIN_DATA = getPluginDataDir(source)         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Scope Application (addPluginScopeToLspServers)               │
│    - Prefix server name: "plugin:name:serverName"              │
│    - Add scope: "dynamic"                                       │
│    - Add source: pluginName                                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. LSP Server Launch                                             │
│    - Spawn process with resolved command, args, env            │
│    - Start LSP client with configuration                        │
└─────────────────────────────────────────────────────────────────┘
```

## Code Flow Analysis

### Entry Point: `getPluginLspServers()`

```typescript
// From lspPluginIntegration.ts
export async function getPluginLspServers(
  plugin: LoadedPlugin,
  errors: PluginError[] = [],
): Promise<Record<string, ScopedLspServerConfig> | undefined> {
  if (!plugin.enabled) {
    return undefined
  }

  // Step 1: Load server definitions
  const servers = plugin.lspServers || (await loadPluginLspServers(plugin, errors))
  if (!servers) {
    return undefined
  }

  // Step 2: Load user config (only if schema exists)
  const userConfig = plugin.manifest.userConfig
    ? loadPluginOptions(getPluginStorageId(plugin))
    : undefined

  // Step 3: Resolve environment variables for each server
  const resolvedServers: Record<string, LspServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    resolvedServers[name] = resolvePluginLspEnvironment(
      config,
      plugin,
      userConfig,
      errors,
    )
  }

  // Step 4: Add plugin scope
  return addPluginScopeToLspServers(resolvedServers, plugin.name)
}
```

### Variable Resolution: `resolvePluginLspEnvironment()`

```typescript
export function resolvePluginLspEnvironment(
  config: LspServerConfig,
  plugin: { path: string; source: string },
  userConfig?: PluginOptionValues,
  _errors?: PluginError[],
): LspServerConfig {
  const allMissingVars: string[] = []

  const resolveValue = (value: string): string => {
    // 1. Plugin-specific variables
    let resolved = substitutePluginVariables(value, plugin)

    // 2. User config variables (if schema exists)
    if (userConfig) {
      resolved = substituteUserConfigVariables(resolved, userConfig)
    }

    // 3. System environment variables
    const { expanded, missingVars } = expandEnvVarsInString(resolved)
    allMissingVars.push(...missingVars)

    return expanded
  }

  const resolved = { ...config }

  // Resolve command path
  if (resolved.command) {
    resolved.command = resolveValue(resolved.command)
  }

  // Resolve args
  if (resolved.args) {
    resolved.args = resolved.args.map(arg => resolveValue(arg))
  }

  // Add built-in env vars + resolve user-defined env vars
  const resolvedEnv: Record<string, string> = {
    CLAUDE_PLUGIN_ROOT: plugin.path,
    CLAUDE_PLUGIN_DATA: getPluginDataDir(plugin.source),
    ...(resolved.env || {}),
  }
  for (const [key, value] of Object.entries(resolvedEnv)) {
    if (key !== 'CLAUDE_PLUGIN_ROOT' && key !== 'CLAUDE_PLUGIN_DATA') {
      resolvedEnv[key] = resolveValue(value)
    }
  }
  resolved.env = resolvedEnv

  // Resolve workspaceFolder if present
  if (resolved.workspaceFolder) {
    resolved.workspaceFolder = resolveValue(resolved.workspaceFolder)
  }

  // Log warnings for missing env vars
  if (allMissingVars.length > 0) {
    const uniqueMissingVars = [...new Set(allMissingVars)]
    logError(new Error(`Missing environment variables: ${uniqueMissingVars.join(', ')}`))
  }

  return resolved
}
```

## Practical Examples

### Example 1: Simple LSP Server with Plugin Paths

**Plugin Structure:**
```
my-plugin@1.0.0/
├── plugin.json
├── bin/
│   └── language-server
└── lib/
    └── helper.js
```

**plugin.json:**
```json
{
  "name": "my-language-plugin",
  "version": "1.0.0",
  "lspServers": {
    "my-language": {
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/language-server",
      "args": ["--stdio", "--lib", "${CLAUDE_PLUGIN_ROOT}/lib/helper.js"],
      "extensionToLanguage": {
        ".mylang": "mylanguage"
      }
    }
  }
}
```

**After Resolution:**
```javascript
{
  command: "/home/user/.claude/plugins/my-plugin@1.0.0/bin/language-server",
  args: [
    "--stdio",
    "--lib", 
    "/home/user/.claude/plugins/my-plugin@1.0.0/lib/helper.js"
  ],
  env: {
    CLAUDE_PLUGIN_ROOT: "/home/user/.claude/plugins/my-plugin@1.0.0",
    CLAUDE_PLUGIN_DATA: "/home/user/.claude/plugin-data/my-plugin@npm"
  },
  extensionToLanguage: { ".mylang": "mylanguage" }
}
```

### Example 2: LSP Server with User Configuration

**Plugin Structure:**
```
my-ai-plugin@2.0.0/
├── plugin.json
└── server.js
```

**plugin.json:**
```json
{
  "name": "ai-language-server",
  "version": "2.0.0",
  "userConfig": {
    "openaiKey": {
      "type": "string",
      "title": "OpenAI API Key",
      "description": "Your OpenAI API key for AI-powered completions",
      "sensitive": true
    },
    "model": {
      "type": "string",
      "title": "Model Name",
      "default": "gpt-4"
    },
    "maxTokens": {
      "type": "number",
      "title": "Max Tokens",
      "default": 2048
    }
  },
  "lspServers": {
    "ai-server": {
      "command": "node",
      "args": [
        "${CLAUDE_PLUGIN_ROOT}/server.js",
        "--model", "${user_config.model}",
        "--max-tokens", "${user_config.maxTokens}"
      ],
      "env": {
        "OPENAI_API_KEY": "${user_config.openaiKey}",
        "LOG_LEVEL": "info",
        "CACHE_DIR": "${CLAUDE_PLUGIN_DATA}/cache"
      }
    }
  }
}
```

**User Enables Plugin:**
```
? Enter your OpenAI API Key: sk-xxxxx
? Model Name (gpt-4): gpt-4-turbo
? Max Tokens (2048): 4096
```

**Storage:**
- `settings.json`: `{ model: "gpt-4-turbo", maxTokens: 4096 }`
- Keychain: `{ openaiKey: "sk-xxxxx" }`

**After Resolution:**
```javascript
{
  command: "node",
  args: [
    "/home/user/.claude/plugins/my-ai-plugin@2.0.0/server.js",
    "--model", "gpt-4-turbo",
    "--max-tokens", "4096"
  ],
  env: {
    CLAUDE_PLUGIN_ROOT: "/home/user/.claude/plugins/my-ai-plugin@2.0.0",
    CLAUDE_PLUGIN_DATA: "/home/user/.claude/plugin-data/my-ai-plugin@npm",
    OPENAI_API_KEY: "sk-xxxxx",
    LOG_LEVEL: "info",
    CACHE_DIR: "/home/user/.claude/plugin-data/my-ai-plugin@npm/cache"
  }
}
```

### Example 3: Multiple LSP Servers with Shared Config

**plugin.json:**
```json
{
  "name": "multi-language-plugin",
  "userConfig": {
    "lspTimeout": {
      "type": "number",
      "title": "LSP Timeout (ms)",
      "default": 5000
    }
  },
  "lspServers": {
    "python-lsp": {
      "command": "pylsp",
      "args": ["--timeout", "${user_config.lspTimeout}"],
      "extensionToLanguage": { ".py": "python" }
    },
    "rust-lsp": {
      "command": "rust-analyzer",
      "args": ["--timeout", "${user_config.lspTimeout}"],
      "extensionToLanguage": { ".rs": "rust" }
    }
  }
}
```

Both servers share the same user-configured timeout value.

## Advanced Patterns

### Pattern 1: Optional Environment Variables with Defaults

```json
{
  "lspServers": {
    "flexible-server": {
      "command": "my-server",
      "args": [
        "--port", "${MY_PORT:-8080}",
        "--host", "${MY_HOST:-localhost}"
      ],
      "env": {
        "DEBUG": "${DEBUG_MODE:-false}",
        "LOG_FILE": "${LOG_DIR:-${CLAUDE_PLUGIN_DATA}}/server.log"
      }
    }
  }
}
```

### Pattern 2: Conditional Configuration Paths

```json
{
  "lspServers": {
    "adaptive-server": {
      "command": "${CUSTOM_SERVER_PATH:-${CLAUDE_PLUGIN_ROOT}/bin/server}",
      "env": {
        "CONFIG_DIR": "${user_config.customConfigPath:-${CLAUDE_PLUGIN_DATA}/config}"
      }
    }
  }
}
```

### Pattern 3: Chained Variable References

```json
{
  "userConfig": {
    "workspaceRoot": {
      "type": "string",
      "title": "Workspace Root"
    }
  },
  "lspServers": {
    "workspace-server": {
      "command": "workspace-lsp",
      "args": [
        "--workspace", "${user_config.workspaceRoot}",
        "--cache", "${user_config.workspaceRoot}/.cache"
      ],
      "workspaceFolder": "${user_config.workspaceRoot}"
    }
  }
}
```

## Error Handling

### Missing User Config Key

If a plugin references `${user_config.key}` but doesn't declare it in `userConfig`:
```
Error: Missing required user configuration value: key.
This should have been validated before variable substitution.
```

This is a plugin authoring error - the plugin should declare all config keys.

### Missing Environment Variable

If `${MY_VAR}` is not set and has no default:
```
Warning: Missing environment variables in plugin LSP config: MY_VAR
```
The variable remains as `${MY_VAR}` in the final config, and the server may fail to start.

### Invalid Path

If a plugin tries to reference files outside its directory:
```
Error: Security: Path traversal attempt blocked in plugin my-plugin: ../../../etc/passwd
```

## Security Considerations

1. **Path Traversal Protection**: `validatePathWithinPlugin()` prevents `..` attacks
2. **Sensitive Value Protection**: Values marked `sensitive: true` go to keychain, not logs
3. **Variable Validation**: All configs validated against Zod schemas before use
4. **Missing Env Vars**: Logged as warnings, don't block server startup
5. **Scope Isolation**: Each server gets `plugin:name:server` scope to prevent conflicts

## Best Practices

### For Plugin Authors

1. **Always use `${CLAUDE_PLUGIN_ROOT}`** for plugin-relative paths
2. **Use `${CLAUDE_PLUGIN_DATA}`** for persistent data that survives updates
3. **Declare user config schemas** for all configurable values
4. **Mark sensitive values** with `sensitive: true`
5. **Provide sensible defaults** for optional configuration
6. **Validate required env vars** at plugin load time, not server start time

### For Plugin Users

1. **Provide all required user config values** when prompted
2. **Use sensitive storage** for API keys and tokens
3. **Set environment variables** before launching Claude Code
4. **Check plugin data directory** for logs and cache

## Key Files Reference

| File | Purpose |
|------|---------|
| `schemas.ts` | LspServerConfigSchema validation |
| `lspPluginIntegration.ts` | LSP server loading & env resolution |
| `pluginOptionsStorage.ts` | User config storage & retrieval |
| `envExpansion.ts` | Environment variable expansion |
| `config.ts` | getAllLspServers integration |

## Summary

The LSP plugin environment variable system provides:

1. **Three-tier variable substitution**: Plugin vars → User config → System env
2. **Secure storage**: Keychain for sensitive values
3. **Automatic injection**: Built-in CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA
4. **Validation**: Schema-based validation and path traversal protection
5. **Scoping**: Plugin-isolated server names to prevent conflicts
6. **Error handling**: Missing vars logged, invalid configs rejected

This system ensures LSP servers have access to necessary configuration while maintaining security and isolation between plugins.
