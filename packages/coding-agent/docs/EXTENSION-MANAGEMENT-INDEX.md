# Extension Management Documentation Index

This directory contains comprehensive documentation for managing extensions in the pi-coding-agent.

## Documentation Files

### Main Documentation

- **[extensions.md](./extensions.md)** - Complete extension system documentation
  - How to create extensions
  - Available APIs and events
  - Custom tools and commands
  - Extension lifecycle

### Extension Management Guides

- **[DISABLE-EXTENSIONS.md](./DISABLE-EXTENSIONS.md)** - How to disable or remove extensions
  - 4 different methods to disable extensions
  - CLI commands (`pi remove`, `pi --no-extensions`)
  - Manual configuration editing
  - Troubleshooting guide
  - Best practices

- **[EXTENSION-QUICK-REFERENCE.md](./EXTENSION-QUICK-REFERENCE.md)** - Quick reference cheat sheet
  - One-page command reference
  - Common operations table
  - Extension locations
  - Quick troubleshooting

- **[EXTENSION-SYSTEM-DIAGRAM.md](./EXTENSION-SYSTEM-DIAGRAM.md)** - Visual diagrams
  - Extension loading flow
  - Discovery process
  - Disable decision tree
  - Settings file structure

## Quick Reference

### Common Tasks

| Task | Command | Documentation |
|------|---------|---------------|
| List all extensions | `pi list` | [Quick Reference](./EXTENSION-QUICK-REFERENCE.md) |
| Disable for session | `pi --no-extensions` | [Disable Guide](./DISABLE-EXTENSIONS.md) |
| Remove extension | `pi remove <path>` | [Disable Guide](./DISABLE-EXTENSIONS.md) |
| View settings | Edit `~/.pi/agent/settings.json` | [System Diagram](./EXTENSION-SYSTEM-DIAGRAM.md) |
| Reload extensions | `/reload` command | [Main Docs](./extensions.md) |

### Extension Locations

| Location | Scope | Discovery |
|----------|-------|-----------|
| `~/.pi/agent/extensions/` | Global | Auto-loaded |
| `.pi/extensions/` | Project | Auto-loaded |
| Custom path | Varies | `pi -e ./path.ts` |

### Disable Methods

| Method | Scope | Permanent | Documentation |
|--------|-------|-----------|---------------|
| `--no-extensions` | Session | No | [Method 1](./DISABLE-EXTENSIONS.md#method-1---temporary-disable-all-extensions) |
| `pi remove` | Global | Yes | [Method 2](./DISABLE-EXTENSIONS.md#method-2---remove-from-settings-via-cli) |
| Edit settings | Global | Yes | [Method 3](./DISABLE-EXTENSIONS.md#method-3---manual-settings-editing) |
| Delete file | Varies | Yes | [Method 4](./DISABLE-EXTENSIONS.md#method-4---delete-or-rename-extension-files) |

## Getting Started

1. **New to extensions?** Start with [extensions.md](./extensions.md)
2. **Need to disable an extension?** Read [DISABLE-EXTENSIONS.md](./DISABLE-EXTENSIONS.md)
3. **Quick command reference?** See [EXTENSION-QUICK-REFERENCE.md](./EXTENSION-QUICK-REFERENCE.md)
4. **Visual learner?** Check [EXTENSION-SYSTEM-DIAGRAM.md](./EXTENSION-SYSTEM-DIAGRAM.md)

## Additional Resources

- [Examples Directory](../examples/extensions/) - Working extension examples
- [Development Guide](./development.md) - Contributing to pi
- [Settings Guide](./settings.md) - Configuration reference
