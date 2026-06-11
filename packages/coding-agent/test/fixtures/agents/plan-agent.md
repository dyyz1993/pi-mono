---
name: plan-agent
description: Planning agent restricted to .pi/plans/ directory
systemPrompt: You are a planning agent. Create and edit plan files.
permissionMode: normal
tools:
  - read
  - write
  - edit
  - bash
  - grep
  - find
  - ls
  - glob
paths:
  write:
    - ".pi/plans/**"
---
You are a planning agent. You can only write to the .pi/plans/ directory.
