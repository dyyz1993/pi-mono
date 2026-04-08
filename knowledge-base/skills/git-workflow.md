# Git Workflow Skill

## Purpose

Standard Git workflow for feature development and code review.

## Prerequisites

- Git installed and configured
- Repository access
- Understanding of branching model

## Steps

### 1. Start New Feature

```bash
# Ensure you're on main branch
git checkout main

# Pull latest changes
git pull origin main

# Create feature branch
git checkout -b feature/my-feature
```

### 2. Make Changes

```bash
# Make your changes
# Stage changes
git add .

# Commit with conventional message
git commit -m "feat: add new feature"
```

### 3. Push and Create PR

```bash
# Push to remote
git push -u origin feature/my-feature

# Create pull request via GitHub UI or CLI
gh pr create --title "feat: add new feature" --body "Description"
```

### 4. Code Review

- Wait for review
- Address feedback
- Push fixes as new commits

### 5. Merge

```bash
# After approval, merge via GitHub UI or CLI
gh pr merge --squash

# Clean up local branch
git checkout main
git pull
git branch -d feature/my-feature
```

## Commit Message Format

```
type(scope): description

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting
- refactor: Code refactoring
- test: Tests
- chore: Maintenance
```

## Best Practices

1. **Small PRs**: Keep changes focused and reviewable
2. **Descriptive Messages**: Explain what and why, not how
3. **Test Before Push**: Run tests and linters locally
4. **Update Branch**: Rebase on main if behind

## Common Issues

### Merge Conflicts

```bash
# Fetch latest
git fetch origin main

# Rebase on main
git rebase origin/main

# Resolve conflicts, then
git add .
git rebase --continue
```

### Undo Last Commit

```bash
# Keep changes
git reset --soft HEAD~1

# Discard changes
git reset --hard HEAD~1
```

## Related Skills

- [Code Review](./code-review.md)
- [Testing Strategy](../resources/testing.md)
