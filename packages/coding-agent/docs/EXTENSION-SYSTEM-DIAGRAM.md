# Extension Loading Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         pi-coding-agent startup                          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  --no-extensions flag?  │
                    └────────────┬───────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                   YES                       NO
                    │                         │
                    ▼                         ▼
        ┌─────────────────────┐    ┌──────────────────────┐
        │  Skip auto-discovery │    │  Discover extensions  │
        └──────────┬──────────┘    └──────────┬───────────┘
                   │                          │
                   │                          ▼
                   │               ┌──────────────────────┐
                   │               │  Project-local:       │
                   │               │  .pi/extensions/*     │
                   │               └──────────┬───────────┘
                   │                          │
                   │                          ▼
                   │               ┌──────────────────────┐
                   │               │  Global:              │
                   │               │  ~/.pi/extensions/*   │
                   │               └──────────┬───────────┘
                   │                          │
                   │                          ▼
                   │               ┌──────────────────────┐
                   │               │  Settings:            │
                   │               │  extensions: [...]    │
                   │               └──────────┬───────────┘
                   │                          │
                   └─────────────┬────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  --extension flags?     │
                    └────────────┬───────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                   YES                       NO
                    │                         │
                    ▼                         │
        ┌─────────────────────┐              │
        │  Load explicit paths │              │
        └──────────┬──────────┘              │
                   │                         │
                   └────────────┬────────────┘
                                │
                                ▼
                   ┌────────────────────────┐
                   │  Load all discovered &  │
                   │  explicit extensions    │
                   └────────────┬───────────┘
                                │
                                ▼
                   ┌────────────────────────┐
                   │  Agent ready!           │
                   └────────────────────────┘
```

## Extension Discovery Order

```
Priority 1: --extension flag (explicit, session only)
    │
    ▼
    pi -e /path/to/ext.ts -e /path/to/ext2.ts
    (Loaded in order specified)


Priority 2: --no-extensions flag
    │
    ▼
    pi --no-extensions
    (Skips auto-discovery, -e paths still work)


Priority 3: Auto-discovered extensions
    │
    ├─► Project-local: <project>/.pi/extensions/
    │   ├─ *.ts, *.js files
    │   ├─ */index.ts, */index.js subdirs
    │   └─ */package.json with "pi" field
    │
    ├─► Global: ~/.pi/extensions/
    │   ├─ *.ts, *.js files
    │   ├─ */index.ts, */index.js subdirs
    │   └─ */package.json with "pi" field
    │
    └─► Settings: extensions array
        ├─ Global: ~/.pi/settings.json
        └─ Project: <project>/.pi/settings.json
```

## Disable Extension Decision Tree

```
Want to disable an extension?
    │
    ├─► Just for testing?
    │   └─► Use: pi --no-extensions
    │       (Temporary, session only)
    │
    ├─► Want to remove permanently?
    │   ├─► Use CLI: pi remove <path>
    │   │   (Removes from settings)
    │   │
    │   ├─► Edit settings manually
    │   │   (More control)
    │   │
    │   └─► Delete/rename file
    │       (Physically remove)
    │
    └─► Want to keep but not load?
        └─► Rename to .disabled
            (Preserves file)
```

## Settings File Structure

```json
{
  "model": "claude-3-5-sonnet",
  "extensions": [
    "~/.pi/extensions/git-undo-debug.ts",        // Global extension
    "~/.pi/extensions/plan-mode.ts",             // Global extension
    "./extensions/project-specific.ts"           // Project-relative
  ],
  "themes": ["~/.pi/themes/custom.json"],
  "skills": ["~/.pi/skills/review.md"],
  "prompts": ["~/.pi/prompts/code-review.md"]
}
```

## Common File Locations

```
~/.pi/                              # Global pi directory
├── settings.json                   # Global settings
├── extensions/                     # Global extensions
│   ├── extension-A.ts              # Simple extension
│   ├── extension-B.ts.disabled     # Disabled (not loaded)
│   └── complex-extension/          # Complex package
│       ├── index.ts
│       └── package.json
├── themes/
├── skills/
└── prompts/

<project>/.pi/                      # Project-local directory
├── settings.json                   # Project settings
└── extensions/                     # Project extensions
    └── project-ext.ts
```

## Extension Loading Process

```
1. Parse CLI args
   ├─ Extract --extension paths
   └─ Check --no-extensions flag

2. Auto-discovery (if not disabled)
   ├─ Scan <project>/.pi/extensions/
   ├─ Scan ~/.pi/extensions/
   └─ Read settings.extensions array

3. Load extensions
   ├─ Resolve paths (~/, ./, absolute)
   ├─ Use jiti to transpile TypeScript
   ├─ Call extension factory function
   └─ Register tools, commands, handlers

4. Initialize runtime
   ├─ Bind core actions
   └─ Register providers

5. Ready for use
```

## Related Documentation

- **Full Guide:** [DISABLE-EXTENSIONS.md](./DISABLE-EXTENSIONS.md)
- **Quick Reference:** [EXTENSION-QUICK-REFERENCE.md](./EXTENSION-QUICK-REFERENCE.md)
- **Extension Development:** [EXTENSION-DEVELOPMENT.md](./EXTENSION-DEVELOPMENT.md)
