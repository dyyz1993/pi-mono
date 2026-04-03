# How to Disable Extensions in pi-coding-agent

This guide explains how to disable or remove extensions from pi-coding-agent.

## Quick Reference

| Method | Scope | Permanence | Use Case |
|--------|-------|------------|----------|
| `--no-extensions` flag | Session only | Temporary | Testing, debugging |
| Remove from settings | User choice | Permanent | Disable specific extension |
| Delete/rename file | User choice | Permanent | Uninstall extension |
| `pi remove <source>` | Global | Permanent | Uninstall and clean settings |

## Methods

### 1. Disable All Extensions Temporarily (Session Only)

Use the `--no-extensions` (or `-ne`) flag to start pi without loading any extensions:

```bash
# Disable all extension discovery
pi --no-extensions

# Short form
pi -ne
```

**Note:** Extensions explicitly loaded via `--extension` (or `-e`) will still be loaded:

```bash
# Disable auto-discovery but load specific extension
pi --no-extensions --extension ~/.pi/extensions/my-extension.ts
pi -ne -e ~/.pi/extensions/my-extension.ts
```

### 2. Remove Extension from Settings

Extensions are configured in settings files:

- **Global settings:** `~/.pi/settings.json`
- **Project settings:** `<project>/.pi/settings.json`

Edit the settings file and remove the extension path from the `extensions` array:

```json
{
  "extensions": [
    "~/.pi/extensions/extension-A.ts",
    "~/.pi/extensions/extension-B.ts"
    // Remove or comment out extension-C.ts to disable it
  ]
}
```

#### Using CLI to Remove Extensions

```bash
# Remove extension from settings
pi remove ~/.pi/extensions/git-undo-debug.ts

# Or use the alias
pi uninstall ~/.pi/extensions/git-undo-debug.ts

# Remove project-local extension
pi remove .pi/extensions/my-extension.ts -l
```

Options:
- `-l, --local` - Remove from project settings instead of global settings

### 3. Delete or Rename Extension File

Physically remove or disable the extension file:

```bash
# Delete the extension file
rm ~/.pi/extensions/git-undo-debug.ts

# Or rename to disable (keeps file but prevents loading)
mv ~/.pi/extensions/git-undo-debug.ts ~/.pi/extensions/git-undo-debug.ts.disabled

# For project-local extensions
rm .pi/extensions/my-extension.ts
```

Extension discovery only loads `.ts` and `.js` files, so renaming to `.disabled` prevents loading while preserving the file.

### 4. List Installed Extensions

To see what extensions are currently installed:

```bash
pi list
```

This shows all extensions configured in your settings files (both global and project-local).

### 5. Using the TUI Config Interface

Open the interactive configuration UI:

```bash
pi config
```

This opens a terminal UI where you can:
- View all installed packages
- Enable/disable extensions
- Manage other resources (themes, skills, prompts)

## Extension Discovery Rules

pi automatically discovers and loads extensions from:

1. **Project-local:** `<project>/.pi/extensions/`
   - Direct files: `*.ts`, `*.js`
   - Subdirectories with `index.ts` or `index.js`
   - Subdirectories with `package.json` containing `"pi"` field

2. **Global:** `~/.pi/extensions/`
   - Same discovery rules as project-local

3. **Explicitly configured paths:**
   - Paths in `settings.json` `extensions` array
   - Paths passed via `--extension` flag

**Priority order:** Project-local → Global → Explicitly configured

## Common Scenarios

### Scenario: Disable git-undo-debug extension

```bash
# Option 1: Remove from settings
pi remove ~/.pi/extensions/git-undo-debug.ts

# Option 2: Delete the file
rm ~/.pi/extensions/git-undo-debug.ts

# Option 3: Rename to disable (preserves file)
mv ~/.pi/extensions/git-undo-debug.ts ~/.pi/extensions/git-undo-debug.ts.disabled

# Option 4: Temporary disable for this session
pi --no-extensions
```

### Scenario: Test without any extensions

```bash
# Quick test session without extensions
pi --no-extensions "What is 2+2?"
```

### Scenario: Disable only global extensions, keep project-local

This requires editing settings manually:

```bash
# Edit global settings
vi ~/.pi/settings.json

# Remove extensions array or clear it
# {
#   "extensions": []
# }

# Project-local extensions will still be discovered
```

### Scenario: Disable extension for specific project only

```bash
# Remove from project settings
cd /path/to/project
pi remove .pi/extensions/my-extension.ts -l

# Or edit .pi/settings.json manually
vi .pi/settings.json
```

## Extension File Structure

Standard extension locations:

```
~/.pi/                          # Global pi directory
├── settings.json               # Global settings (includes extensions array)
└── extensions/                 # Global extensions directory
    ├── my-extension.ts         # Simple extension
    └── complex-extension/      # Complex extension package
        ├── index.ts            # Entry point
        └── package.json        # Optional: with "pi" field

project/
└── .pi/
    ├── settings.json           # Project settings
    └── extensions/             # Project-local extensions
        └── project-specific.ts
```

## Troubleshooting

### Extension still loading after removal

Check all locations:
1. `~/.pi/settings.json` - global settings
2. `<project>/.pi/settings.json` - project settings
3. `<project>/.pi/extensions/` - auto-discovered project extensions
4. `~/.pi/extensions/` - auto-discovered global extensions

### Can't find extension file

Extensions might be in a custom location. Check your settings:

```bash
# View settings
cat ~/.pi/settings.json
cat .pi/settings.json

# Or use pi list to see configured paths
pi list
```

### Extension errors on startup

Temporarily disable all extensions to isolate the issue:

```bash
pi --no-extensions
```

Then re-enable extensions one by one to identify the problematic one.

## Related Commands

```bash
# Install an extension
pi install <source> [-l]

# Remove/uninstall an extension
pi remove <source> [-l]
pi uninstall <source> [-l]  # alias

# Update extensions
pi update [source]

# List installed extensions
pi list

# Configure via TUI
pi config

# Load specific extensions only
pi --no-extensions --extension path/to/ext1.ts --extension path/to/ext2.ts
```

## Flags Reference

| Flag | Short | Description |
|------|-------|-------------|
| `--extension <path>` | `-e` | Load a specific extension file (can use multiple times) |
| `--no-extensions` | `-ne` | Disable automatic extension discovery (explicit `-e` paths still work) |
| `--local` | `-l` | Use project settings instead of global settings |

## See Also

- [Extension Development Guide](./EXTENSION-DEVELOPMENT.md)
- [Settings Reference](./SETTINGS.md)
- [Package Management](./PACKAGE-MANAGEMENT.md)
