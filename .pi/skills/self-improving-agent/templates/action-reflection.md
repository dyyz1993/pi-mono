# Action Reflection Template

Quick reflection after each significant action.

## Format

```markdown
## Action Reflection: [Action Name]

**Timestamp**: [When]
**Context**: [Situation]

### Action Taken
- **What**: [Description of action]
- **Why**: [Reasoning behind choice]
- **How**: [Method/approach used]

### Outcome
- **Result**: [What actually happened]
- **Success**: [Did it work as intended?]
- **Surprises**: [Unexpected results]

### Gap Analysis
- **Intent vs Reality**: [Difference between expected and actual]
- **Root Cause**: [Why the gap occurred]

### Immediate Adjustment
- **Next Time**: [Specific change to make]
- **Apply Now**: [Can I fix this immediately?]

### Metrics
- **Time**: [Duration]
- **Iterations**: [Number of attempts]
- **Resources**: [Tokens/tools used]
```

## Example

```markdown
## Action Reflection: File Search Strategy

**Timestamp**: 2024-01-15 14:32
**Context**: Looking for authentication implementation

### Action Taken
- **What**: Used grep to search for "auth" in all files
- **Why**: Fast way to find auth-related code
- **How**: `grep -r "auth" --include="*.ts"`

### Outcome
- **Result**: Found 47 matches across 23 files
- **Success**: Yes, found the files
- **Surprises**: Many false positives from comments

### Gap Analysis
- **Intent vs Reality**: Wanted specific files, got too many results
- **Root Cause**: Search term too broad

### Immediate Adjustment
- **Next Time**: Use more specific pattern like "authenticate\|authService"
- **Apply Now**: Refine current search

### Metrics
- **Time**: 2 minutes
- **Iterations**: 1 (but will need another)
- **Resources**: Simple grep, low cost
```

## Usage Tips

1. **Be Honest**: Acknowledge failures and partial successes
2. **Be Specific**: Vague reflections don't lead to improvements
3. **Be Quick**: Don't overthink, capture the essential insights
4. **Be Actionable**: Always include "Next Time" guidance
5. **Be Consistent**: Apply after every significant action

## When to Use

- After completing a tool invocation
- After making a decision
- After receiving user feedback
- After encountering an error
- After achieving a milestone

## When to Skip

- Routine actions (reading known files)
- Trivial decisions
- Actions with no learning value
