# 🐛 Skills Collision Diagnostic Bug Report

## Summary
The `loadSkills()` function has a **critical bug** that prevents collision diagnostics from being emitted when skills from different paths have the same name.

## Root Cause Analysis

### 1. The Problem

When loading skills with explicit `skillPaths`, the collision detection logic fails to recognize collisions because `sourceInfo.source` is incorrectly set.

### 2. Evidence from Test

**Test expectation:**
```typescript
expect(skills[0].sourceInfo.source).toBe(first);
// Expected: "/Users/.../skills-collision/first"
// Received: "local"  ❌
```

**Actual behavior:**
- `loadSkillsFromDir({ dir: first, source: first })` returns skills with `sourceInfo.source = first`
- BUT `loadSkills()` then overwrites it with `"local"` ❌

### 3. Code Trace

#### Step 1: `loadSkillsFromDir()` correctly sets `source` (line 146)
```typescript
export function loadSkillsFromDir(options: { dir: string; source: string }): {
  // ...
  const sourceInfo: SkillSourceInfo = {
    source: options.source,  // ✅ Correct: absolute path from skillPaths
    relativePath,
  };
}
```

#### Step 2: `loadSkills()` overwrites it with `"local"` (line 261)
```typescript
// line 256-261
skill.sourceInfo = {
  source: "local",  // ❌ BUG: Hardcoded "local", should use pathOrAlias!
  relativePath: relative(cwd, skill.filePath),
};
```

### 4. Impact

1. **Collision detection breaks**: All skills loaded via `skillPaths` get `sourceInfo.source = "local"`, so they appear to come from the same source
2. **Diagnostics not emitted**: The collision warning is generated but never added to `diagnostics` array
3. **Users lose visibility**: Skills are silently overwritten without warning

## The Fix

### Fix #1: Preserve the actual source (Primary Fix)

**Location:** `packages/coding-agent/src/skills.ts:256-261`

**Current code:**
```typescript
skill.sourceInfo = {
  source: "local",  // ❌ WRONG
  relativePath: relative(cwd, skill.filePath),
};
```

**Fixed code:**
```typescript
skill.sourceInfo = {
  source: pathOrAlias,  // ✅ Use the actual path/alias
  relativePath: relative(cwd, skill.filePath),
};
```

**Why this works:**
- `pathOrAlias` already contains the normalized path from `skillPaths` array
- Each skill gets its correct source identifier
- Collision detection can now distinguish between different sources

### Fix #2: Emit collision diagnostic (Secondary Fix)

**Location:** `packages/coding-agent/src/skills.ts:287-292`

**Current code:**
```typescript
// line 287-292
} else {
  skillMap.set(skill.name, skill);
}
```

**Fixed code:**
```typescript
} else {
  // Add collision diagnostic when a skill with the same name already exists
  const collisionMessage = `Skill name collision: "${skill.name}" is already loaded from ${existing.filePath}. Skipping ${skill.filePath}`;
  diagnostics.push({
    filePath: skill.filePath,
    message: collisionMessage,
    severity: "warning",
		source: "skill-loader",
  });
}
```

**Why this works:**
- Collision warnings are now captured in the `diagnostics` array
- Users can see which skills were skipped due to collisions
- Integrates with existing diagnostic reporting system

## Test Plan

### Integration Test (Added)
```typescript
it("should emit collision diagnostic when skills have the same name", () => {
  const first = join(collisionFixturesDir, "first");
  const second = join(collisionFixturesDir, "second");
  
  const { skills, diagnostics } = loadSkills({
    agentDir: emptyAgentDir,
    cwd: emptyCwd,
    skillPaths: [first, second],
  });

  // Should have only one skill (first one wins)
  expect(skills).toHaveLength(1);
  expect(skills[0].name).toBe("calendar");
  expect(skills[0].sourceInfo.source).toBe(first);  // ✅ Should pass after fix

  // Should have one collision diagnostic
  const collisionDiag = diagnostics.find(d => 
    d.message.includes("collision") && d.message.includes("calendar")
  );
  expect(collisionDiag).toBeDefined();  // ✅ Should pass after fix
});
```

### Manual Testing Steps
1. Create two skill directories with skills having the same name
2. Call `loadSkills({ skillPaths: [dir1, dir2] })`
3. Verify:
   - Only one skill is loaded (first wins)
   - A collision diagnostic is present
   - `skill.sourceInfo.source` equals the actual path, not "local"

## Priority

**P0 - Critical** 

This bug affects users who:
1. Load skills from multiple directories
2. Have skills with the same name
3. Need collision warnings to diagnose why skills are missing

The fix is simple, isolated, and has minimal risk of side effects.
