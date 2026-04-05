# LSP Plugin Environment Variables - Architecture Diagram

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Claude Code Application                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Plugin System                                     │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         Plugin Loader                                     │ │
│  │  • Load manifest.json                                                    │ │
│  │  • Validate schema                                                       │ │
│  │  • Check .lsp.json file                                                  │ │
│  │  • Cache LSP servers                                                     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                        │
│                                       ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    User Configuration Manager                             │ │
│  │                                                                           │ │
│  │  ┌──────────────────┐        ┌──────────────────────┐                   │ │
│  │  │  settings.json   │        │    Secure Storage     │                   │ │
│  │  │                  │        │    (Keychain)         │                   │ │
│  │  │  pluginConfigs:  │        │                       │                   │ │
│  │  │    [pluginId]:   │        │  pluginSecrets:       │                   │ │
│  │  │      options: {} │        │    [pluginId]: {}     │                   │ │
│  │  └──────────────────┘        └──────────────────────┘                   │ │
│  │           │                            │                                  │ │
│  │           └──────────┬─────────────────┘                                  │ │
│  │                      │                                                    │ │
│  │                      ▼                                                    │ │
│  │           ┌─────────────────────┐                                         │ │
│  │           │ loadPluginOptions() │                                         │ │
│  │           │ (memoized)          │                                         │ │
│  │           │ Merges both sources │                                         │ │
│  │           └─────────────────────┘                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                        │
│                                       ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                   LSP Integration Layer                                   │ │
│  │                                                                           │ │
│  │  1. loadPluginLspServers(plugin)                                         │ │
│  │     - Load from .lsp.json                                                │ │
│  │     - Load from manifest.lspServers                                      │ │
│  │     - Validate with Zod                                                  │ │
│  │                                                                           │ │
│  │  2. resolvePluginLspEnvironment(config, plugin, userConfig)             │ │
│  │     ┌──────────────────────────────────────────────────────────┐        │ │
│  │     │  Resolution Pipeline (per string value)                  │        │ │
│  │     │                                                           │        │ │
│  │     │  Input: "${CLAUDE_PLUGIN_ROOT}/bin/server"               │        │ │
│  │     │     ↓                                                     │        │ │
│  │     │  substitutePluginVariables()                             │        │ │
│  │     │     ${CLAUDE_PLUGIN_ROOT} → /path/to/plugin              │        │ │
│  │     │     ${CLAUDE_PLUGIN_DATA} → /path/to/data                │        │ │
│  │     │     ↓                                                     │        │ │
│  │     │  substituteUserConfigVariables()                         │        │ │
│  │     │     ${user_config.KEY} → userConfig[KEY]                │        │ │
│  │     │     ↓                                                     │        │ │
│  │     │  expandEnvVarsInString()                                 │        │ │
│  │     │     ${VAR} → process.env.VAR                            │        │ │
│  │     │     ${VAR:-default} → env.VAR || default                │        │ │
│  │     │     ↓                                                     │        │ │
│  │     │  Output: "/home/user/.claude/plugins/my-plugin/bin/server"│       │ │
│  │     └──────────────────────────────────────────────────────────┘        │ │
│  │                                                                           │ │
│  │  3. addPluginScopeToLspServers(servers, pluginName)                     │ │
│  │     - Prefix: "plugin:pluginName:serverName"                            │ │
│  │     - Add scope: "dynamic"                                               │ │
│  │     - Add source: pluginName                                             │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              LSP Service                                       │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        Server Registry                                    │ │
│  │                                                                           │ │
│  │  {                                                                        │ │
│  │    "plugin:my-plugin:typescript": {                                      │ │
│  │      command: "/path/to/plugin/bin/server",                             │ │
│  │      args: ["--stdio", "--port", "8080"],                               │ │
│  │      env: {                                                              │ │
│  │        CLAUDE_PLUGIN_ROOT: "/path/to/plugin",                           │ │
│  │        CLAUDE_PLUGIN_DATA: "/path/to/data",                             │ │
│  │        CUSTOM_VAR: "resolved-value"                                      │ │
│  │      },                                                                  │ │
│  │      scope: "dynamic",                                                   │ │
│  │      source: "my-plugin"                                                 │ │
│  │    }                                                                     │ │
│  │  }                                                                        │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                        │
│                                       ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         Server Launcher                                   │ │
│  │                                                                           │ │
│  │  spawn(command, args, {                                                  │ │
│  │    env: { ...process.env, ...serverConfig.env },                        │ │
│  │    cwd: workspaceFolder                                                  │ │
│  │  })                                                                       │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          LSP Server Process                                    │
│                                                                                │
│  Running with environment:                                                    │
│  - CLAUDE_PLUGIN_ROOT=/path/to/plugin                                         │
│  - CLAUDE_PLUGIN_DATA=/path/to/data                                           │
│  - All resolved user variables                                                │
│  - All resolved system variables                                              │
│  - All custom env vars from config                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Sequence

```
User Enables Plugin
        │
        ▼
┌──────────────────────────┐
│ Does manifest have       │──── No ────┐
│ userConfig schema?       │             │
└──────────────────────────┘             │
        │ Yes                            │
        ▼                                │
┌──────────────────────────┐             │
│ Prompt user for values   │             │
│ - Required fields        │             │
│ - Optional with defaults │             │
└──────────────────────────┘             │
        │                                │
        ▼                                │
┌──────────────────────────┐             │
│ Store values:            │             │
│ - Non-sensitive → JSON   │             │
│ - Sensitive → Keychain   │             │
└──────────────────────────┘             │
        │                                │
        └────────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────┐
        │ User opens file with     │
        │ extension matching LSP   │
        └──────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────┐
        │ getPluginLspServers()    │
        │ called for matching      │
        │ plugin                   │
        └──────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────┐
        │ loadPluginLspServers()   │
        │ - Check cache            │
        │ - Load .lsp.json         │
        │ - Load manifest.lspServers│
        │ - Validate schemas       │
        └──────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────┐
        │ loadPluginOptions()      │
        │ - Check memoize cache    │
        │ - Read settings.json     │
        │ - Read keychain          │
        │ - Merge both sources     │
        └──────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────────────────┐
        │ resolvePluginLspEnvironment()        │
        │                                       │
        │ For each LSP server config:          │
        │                                       │
        │ command: "${CLAUDE_PLUGIN_ROOT}/bin" │
        │          ↓                            │
        │          substitutePluginVariables()  │
        │          "/home/user/.claude/..."     │
        │          ↓                            │
        │ args: ["--key", "${user_config.key}"] │
        │          ↓                            │
        │          substituteUserConfigVariables()│
        │          ["--key", "actual-key-value"] │
        │          ↓                            │
        │ env.PORT: "${PORT:-8080}"            │
        │          ↓                            │
        │          expandEnvVarsInString()      │
        │          "3000" (or "8080")           │
        │          ↓                            │
        │ Add built-in env vars:               │
        │   CLAUDE_PLUGIN_ROOT                 │
        │   CLAUDE_PLUGIN_DATA                 │
        └──────────────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────┐
        │ addPluginScopeToLspServers()│
        │ - Prefix server name     │
        │ - Add metadata           │
        └──────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────┐
        │ LSP Service receives     │
        │ resolved configuration   │
        └──────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────┐
        │ Launch server process:   │
        │                          │
        │ spawn(                   │
        │   resolvedCommand,       │
        │   resolvedArgs,          │
        │   {                      │
        │     env: resolvedEnv     │
        │   }                      │
        │ )                        │
        └──────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────┐
        │ LSP server running with  │
        │ all environment variables│
        │ properly resolved        │
        └──────────────────────────┘
```

## Component Interaction Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    pluginOptionsStorage.ts                      │
│                                                                  │
│  Functions:                                                     │
│  - loadPluginOptions(pluginId) → PluginOptionValues            │
│  - savePluginOptions(pluginId, values, schema)                 │
│  - substitutePluginVariables(value, plugin) → string           │
│  - substituteUserConfigVariables(value, config) → string       │
│                                                                  │
│  Dependencies:                                                  │
│  - settings.js → getSettings_DEPRECATED()                      │
│  - secureStorage → getSecureStorage()                          │
│  - pluginDirectories.ts → getPluginDataDir()                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ uses
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                         envExpansion.ts                         │
│                                                                  │
│  Functions:                                                     │
│  - expandEnvVarsInString(value) → {                           │
│      expanded: string,                                          │
│      missingVars: string[]                                     │
│    }                                                             │
│                                                                  │
│  Features:                                                      │
│  - ${VAR} syntax support                                       │
│  - ${VAR:-default} default values                              │
│  - Missing variable tracking                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ used by
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    lspPluginIntegration.ts                      │
│                                                                  │
│  Functions:                                                     │
│  - loadPluginLspServers(plugin, errors) → Record<string, Config>│
│  - validatePathWithinPlugin(pluginPath, relativePath) → string │
│  - resolvePluginLspEnvironment(config, plugin, userConfig) → Config│
│  - addPluginScopeToLspServers(servers, name) → ScopedConfig    │
│  - getPluginLspServers(plugin, errors) → ScopedConfig          │
│  - extractLspServersFromPlugins(plugins, errors) → ScopedConfig│
│                                                                  │
│  Dependencies:                                                  │
│  - pluginOptionsStorage.ts (substitution)                      │
│  - envExpansion.ts (env vars)                                  │
│  - schemas.ts (validation)                                     │
│  - pluginDirectories.ts (paths)                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ provides to
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      services/lsp/config.ts                     │
│                                                                  │
│  Functions:                                                     │
│  - getAllLspServers() → Record<string, ScopedLspServerConfig>  │
│                                                                  │
│  Integration:                                                   │
│  - Calls extractLspServersFromPlugins()                        │
│  - Merges with user-defined LSP servers                        │
│  - Returns complete server registry                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ used by
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    services/lsp/lspService.ts                   │
│                                                                  │
│  Functions:                                                     │
│  - startLspServer(config) → LspServer                          │
│  - getLspServerForFile(filePath) → LspServer                   │
│                                                                  │
│  Usage:                                                         │
│  - Spawns LSP processes with resolved config                   │
│  - Manages server lifecycle                                     │
│  - Routes file operations to correct servers                   │
└─────────────────────────────────────────────────────────────────┘
```

## Variable Resolution Flowchart

```
                    Input String
                         │
                         ▼
         ┌───────────────────────────────┐
         │ Contains ${CLAUDE_PLUGIN_     │
         │ ROOT} or ${CLAUDE_PLUGIN_     │
         │ DATA}?                        │
         └───────────────────────────────┘
                  │            │
                 Yes          No
                  │            │
                  ▼            │
    ┌────────────────────────┐ │
    │ substitutePlugin       │ │
    │ Variables()            │ │
    │                        │ │
    │ Replace:               │ │
    │ ${CLAUDE_PLUGIN_ROOT}  │ │
    │   → plugin.path        │ │
    │ ${CLAUDE_PLUGIN_DATA}  │ │
    │   → getPluginDataDir() │ │
    └────────────────────────┘ │
                  │            │
                  └─────┬──────┘
                        ▼
         ┌───────────────────────────────┐
         │ Contains ${user_config.X}?    │
         └───────────────────────────────┘
                  │            │
                 Yes          No
                  │            │
                  ▼            │
    ┌────────────────────────┐ │
    │ substituteUserConfig   │ │
    │ Variables()            │ │
    │                        │ │
    │ For each match:        │ │
    │ - Extract key name     │ │
    │ - Get value from       │ │
    │   userConfig object    │ │
    │ - Replace if found     │ │
    │ - Throw if missing key │ │
    │   (schema validation   │ │
    │    should prevent)     │ │
    └────────────────────────┘ │
                  │            │
                  └─────┬──────┘
                        ▼
         ┌───────────────────────────────┐
         │ Contains ${VAR} or            │
         │ ${VAR:-default}?              │
         └───────────────────────────────┘
                  │            │
                 Yes          No
                  │            │
                  ▼            │
    ┌────────────────────────┐ │
    │ expandEnvVarsInString()│ │
    │                        │ │
    │ For each match:        │ │
    │ - Extract var name     │ │
    │ - Check process.env    │ │
    │ - Use default if : -   │ │
    │ - Track missing vars   │ │
    │ - Leave as-is if       │ │
    │   not found & no       │ │
    │   default              │ │
    └────────────────────────┘ │
                  │            │
                  └─────┬──────┘
                        ▼
                   Final String
                   (Fully Resolved)
```

## Storage Locations

```
~/.claude/
├── settings.json                    ← Non-sensitive plugin config
│   {
│     "pluginConfigs": {
│       "my-plugin@npm": {
│         "enabled": true,
│         "options": {              ← User config (non-sensitive)
│           "model": "gpt-4",
│           "timeout": 5000
│         }
│       }
│     }
│   }
│
├── plugins/                         ← Plugin installations
│   └── my-plugin@1.0.0/            ← ${CLAUDE_PLUGIN_ROOT}
│       ├── plugin.json
│       ├── bin/
│       │   └── server
│       └── lib/
│
├── plugin-data/                     ← Persistent plugin data
│   └── my-plugin@npm/              ← ${CLAUDE_PLUGIN_DATA}
│       ├── cache/
│       ├── logs/
│       └── state.json
│
└── [Keychain/Secure Storage]        ← Sensitive plugin config
    {
      "pluginSecrets": {
        "my-plugin@npm": {          ← User config (sensitive)
          "apiKey": "sk-xxxxx",
          "password": "secret123"
        }
      }
    }
```

## Summary

The LSP plugin environment variable system is a sophisticated three-tier substitution mechanism that:

1. **Isolates plugin resources** with built-in variables (`CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`)
2. **Enables user customization** through a secure configuration system
3. **Leverages system environment** with fallback defaults
4. **Maintains security** through validation, path restrictions, and secure storage
5. **Ensures reliability** through memoization, caching, and error handling

The flow is:
**Plugin Config → User Config Loading → Variable Resolution → Server Scoping → Process Spawning**

All of this happens transparently to the end user, who only needs to provide configuration values when enabling a plugin.
