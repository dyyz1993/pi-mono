# Extension Management Quick Reference

## Disable Extensions

### Temporarily (This Session Only)
```bash
pi --no-extensions          # Disable all auto-discovered extensions
pi -ne                      # Short form

pi -ne -e my-ext.ts         # Disable auto-discovery, load specific extension
```

### Permanently

#### Option 1: CLI Command
```bash
pi remove ~/.pi/extensions/git-undo-debug.ts
pi uninstall ~/.pi/extensions/git-undo-debug.ts    # Alias
pi remove .pi/extensions/my-ext.ts -l              # Project-local
```

#### Option 2: Edit Settings
```bash
# Global: ~/.pi/settings.json
# Project: <project>/.pi/settings.json

{
  "extensions": [
    "~/.pi/extensions/extension-A.ts",
    // Remove the extension you want to disable
  ]
}
```

#### Option 3: Delete/Rename File
```bash
rm ~/.pi/extensions/extension.ts                      # Delete
mv ~/.pi/extensions/extension.ts extension.ts.disabled  # Rename
```

## Install Extensions

```bash
pi install ~/.pi/extensions/new-extension.ts
pi install https://example.com/extension.ts
pi install .pi/extensions/project-ext.ts -l    # Project-local
```

## List Extensions

```bash
pi list          # Show all installed extensions
pi config        # Open TUI configuration
```

## Extension Locations

| Location | Type | Auto-discovered |
|----------|------|----------------|
| `~/.pi/extensions/` | Global | ✅ Yes |
| `<project>/.pi/extensions/` | Project-local | ✅ Yes |
| Settings `extensions` array | Explicit | ❌ No (manual) |
| `--extension` flag | Session | ❌ No (temporary) |

## Common Commands

| Task | Command |
|------|---------|
| Disable all extensions (session) | `pi --no-extensions` |
| Load specific extension | `pi -e path/to/extension.ts` |
| Install extension | `pi install <source>` |
| Remove extension | `pi remove <source>` |
| List installed | `pi list` |
| Configure via TUI | `pi config` |

## Example: Disable git-undo-debug.ts

```bash
# Quick method (permanent)
pi remove ~/.pi/extensions/git-undo-debug.ts

# Or manually
rm ~/.pi/extensions/git-undo-debug.ts

# Or temporary (just this session)
pi --no-extensions
```

## Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--extension` | `-e` | Load specific extension |
| `--no-extensions` | `-ne` | Disable auto-discovery |
| `--local` | `-l` | Use project settings |

## Need More Help?

📖 Full documentation: [DISABLE-EXTENSIONS.md](./DISABLE-EXTENSIONS.md)
