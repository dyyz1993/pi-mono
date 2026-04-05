# Example LSP Plugin - Environment Variables Demo

This example demonstrates how to use environment variables in LSP plugins.

## What This Example Shows

### 1. User Configuration Schema

The plugin declares a `userConfig` section in `plugin.json` with four configuration options:

- **serverPort** (number): Non-sensitive, stored in settings.json
- **apiKey** (string, sensitive): Secret value, stored in keychain
- **logLevel** (enum): Non-sensitive with predefined options
- **enableDebug** (boolean): Non-sensitive with default value

### 2. Environment Variable Usage

The LSP server configurations demonstrate all three types of variable substitution:

#### Type 1: Plugin-Specific Variables

```json
{
  "command": "${CLAUDE_PLUGIN_ROOT}/server.js",
  "env": {
    "DATA_DIR": "${CLAUDE_PLUGIN_DATA}",
    "CACHE_PATH": "${CLAUDE_PLUGIN_DATA}/cache"
  }
}
```

These variables are automatically provided by the plugin system:
- `${CLAUDE_PLUGIN_ROOT}` → Plugin installation directory
- `${CLAUDE_PLUGIN_DATA}` → Persistent data directory (survives updates)

#### Type 2: User Configuration Variables

```json
{
  "args": ["--port", "${user_config.serverPort}"],
  "env": {
    "API_KEY": "${user_config.apiKey}"
  }
}
```

These variables reference values from the `userConfig` schema:
- `${user_config.serverPort}` → User-provided port number
- `${user_config.apiKey}` → User-provided API key (from keychain)

#### Type 3: System Environment Variables

```json
{
  "args": ["--home", "${HOME}"],
  "env": {
    "NODE_ENV": "${NODE_ENV:-production}",
    "CUSTOM_PATH": "${CUSTOM_BIN_PATH:-/usr/local/bin}"
  }
}
```

These variables reference system environment variables:
- `${HOME}` → User's home directory
- `${NODE_ENV:-production}` → Environment variable with default value
- `${CUSTOM_BIN_PATH:-/usr/local/bin}` → Custom path with fallback

### 3. Multiple Server Configurations

The plugin defines three LSP servers to show different patterns:

#### Server 1: Full Configuration Example

Uses all variable types and user configuration options.

#### Server 2: Minimal Example

Only uses `${CLAUDE_PLUGIN_ROOT}` for the command path.

#### Server 3: Environment Variable Demo

Shows system environment variables with defaults.

## How Variables Are Resolved

When the plugin is loaded and an LSP server is started:

```
1. Plugin Installation
   - Plugin downloaded to: ~/.claude/plugins/example-lsp-plugin@1.0.0/
   - Manifest parsed and validated

2. User Enables Plugin
   - Prompted for: serverPort, apiKey, logLevel, enableDebug
   - Values stored:
     * serverPort, logLevel, enableDebug → settings.json
     * apiKey → keychain

3. File Opened (e.g., test.example)
   - Plugin LSP servers loaded
   - User config loaded (settings.json + keychain)
   - Variables resolved:
     * ${CLAUDE_PLUGIN_ROOT} → /home/user/.claude/plugins/example-lsp-plugin@1.0.0
     * ${CLAUDE_PLUGIN_DATA} → /home/user/.claude/plugin-data/example-lsp-plugin@npm
     * ${user_config.serverPort} → 8080
     * ${user_config.apiKey} → sk-xxxxx
     * ${NODE_ENV:-production} → production

4. Server Started
   - Process spawned with resolved environment:
     API_KEY=sk-xxxxx
     PLUGIN_ROOT=/home/user/.claude/plugins/example-lsp-plugin@1.0.0
     DATA_DIR=/home/user/.claude/plugin-data/example-lsp-plugin@npm
     NODE_ENV=production
     CLAUDE_PLUGIN_ROOT=/home/user/.claude/plugins/example-lsp-plugin@1.0.0
     CLAUDE_PLUGIN_DATA=/home/user/.claude/plugin-data/example-lsp-plugin@npm
```

## Testing the Plugin

### 1. Create Test Files

```bash
# Create test file
echo "print('hello world')" > test.example

# Open in Claude Code
claude-code test.example
```

### 2. Check Server Output

The example `server.js` logs all received environment variables:

```
=== Example LSP Server Started ===
Environment Variables from Plugin System:
  API_KEY: ***provided***
  PLUGIN_ROOT: /home/user/.claude/plugins/example-lsp-plugin@1.0.0
  DATA_DIR: /home/user/.claude/plugin-data/example-lsp-plugin@npm
  CACHE_PATH: /home/user/.claude/plugin-data/example-lsp-plugin@npm/cache
  LOG_FILE: /home/user/.claude/plugin-data/example-lsp-plugin@npm/logs/server.log
  NODE_ENV: production
  CUSTOM_PATH: /usr/local/bin

Command-line Arguments:
  Port: 8080
  Log Level: info
  Debug Mode: false
===================================
```

### 3. Verify Variable Resolution

- Check that `${CLAUDE_PLUGIN_ROOT}` resolves to the actual plugin path
- Check that `${CLAUDE_PLUGIN_DATA}` resolves to the persistent data directory
- Check that `${user_config.serverPort}` resolves to your configured value
- Check that `${NODE_ENV:-production}` resolves to production (or your env value)

## Security Considerations

### Sensitive Values

The `apiKey` is marked as `sensitive: true`:

```json
{
  "apiKey": {
    "type": "string",
    "title": "API Key",
    "sensitive": true
  }
}
```

This means:
- Not logged to console or files
- Not included in skill/agent content (shows as `[sensitive option 'apiKey' not available]`)
- Stored in keychain/secure storage
- Never appears in settings.json

### Path Validation

The plugin system validates paths to prevent directory traversal:

```json
{
  "command": "${CLAUDE_PLUGIN_ROOT}/bin/server"  // ✓ Valid
}
```

```json
{
  "command": "${CLAUDE_PLUGIN_ROOT}/../../../etc/passwd"  // ✗ Blocked
}
```

## Best Practices

### 1. Always Use Plugin Variables for Paths

❌ **Bad:**
```json
{
  "command": "/home/user/plugins/my-plugin/server.js"
}
```

✅ **Good:**
```json
{
  "command": "${CLAUDE_PLUGIN_ROOT}/server.js"
}
```

### 2. Use Data Directory for Persistent State

❌ **Bad:**
```json
{
  "env": {
    "CACHE_DIR": "/tmp/my-plugin-cache"
  }
}
```

✅ **Good:**
```json
{
  "env": {
    "CACHE_DIR": "${CLAUDE_PLUGIN_DATA}/cache"
  }
}
```

### 3. Provide Sensible Defaults

❌ **Bad:**
```json
{
  "args": ["--port", "${user_config.port}"]
}
```

✅ **Good:**
```json
{
  "userConfig": {
    "port": {
      "type": "number",
      "default": 8080
    }
  },
  "args": ["--port", "${user_config.port}"]
}
```

### 4. Use System Variables with Defaults

❌ **Bad:**
```json
{
  "env": {
    "NODE_PATH": "${NODE_PATH}"
  }
}
```

✅ **Good:**
```json
{
  "env": {
    "NODE_PATH": "${NODE_PATH:-/usr/local/lib/node_modules}"
  }
}
```

### 5. Mark Secrets as Sensitive

❌ **Bad:**
```json
{
  "userConfig": {
    "apiKey": {
      "type": "string"
    }
  }
}
```

✅ **Good:**
```json
{
  "userConfig": {
    "apiKey": {
      "type": "string",
      "sensitive": true
    }
  }
}
```

## Directory Structure After Installation

```
~/.claude/
├── settings.json                    # Non-sensitive config
│   {
│     "pluginConfigs": {
│       "example-lsp-plugin@npm": {
│         "enabled": true,
│         "options": {
│           "serverPort": 8080,
│           "logLevel": "info",
│           "enableDebug": false
│         }
│       }
│     }
│   }
│
├── plugins/
│   └── example-lsp-plugin@1.0.0/   # ${CLAUDE_PLUGIN_ROOT}
│       ├── plugin.json
│       └── server.js
│
├── plugin-data/
│   └── example-lsp-plugin@npm/     # ${CLAUDE_PLUGIN_DATA}
│       ├── cache/                   # Created automatically
│       └── logs/
│           └── server.log
│
└── [Keychain]                       # Sensitive config
    {
      "pluginSecrets": {
        "example-lsp-plugin@npm": {
          "apiKey": "your-secret-key-here"
        }
      }
    }
```

## Summary

This example demonstrates:

1. **Three-tier variable substitution**: Plugin vars → User config → System env
2. **Secure storage**: Keychain for sensitive values, JSON for others
3. **Automatic injection**: Built-in CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA
4. **Default values**: Fallback for missing system variables
5. **Security**: Path validation and sensitive value protection

Use this as a template for creating your own LSP plugins with environment variable support!
