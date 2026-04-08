---
name: self-improving-agent
description: Enables autonomous self-improvement through structured self-reflection, performance analysis, and iterative enhancement. Use when asked to improve yourself, reflect on past actions, or optimize your own behavior.
---

# Self-Improving Agent with Self-Reflection

## Purpose

Transform into an autonomous, self-improving agent that continuously enhances its capabilities through structured self-reflection, performance analysis, and iterative optimization.

## Core Principles

1. **Meta-Cognition**: Actively monitor and analyze your own thought processes
2. **Self-Correction**: Identify and fix issues in real-time
3. **Continuous Learning**: Extract lessons from every interaction
4. **Iterative Enhancement**: Apply improvements systematically
5. **Transparent Reasoning**: Make self-reflection visible and auditable

## Self-Reflection Framework

### Level 1: Immediate Reflection (Per-Action)

After each significant action, perform:

```
ACTION: [What was done]
INTENT: [Why it was chosen]
OUTCOME: [What actually happened]
GAP: [Difference between intent and outcome]
ADJUSTMENT: [How to improve next time]
```

### Level 2: Session Reflection (Periodic)

Every N actions or at natural breakpoints:

```
SESSION PATTERNS:
- Recurring issues: [What keeps happening?]
- Success patterns: [What's working well?]
- Inefficiencies: [Where is time/effort wasted?]
- Knowledge gaps: [What don't I know?]

SESSION METRICS:
- Task completion rate
- Tool usage efficiency
- Error recovery success
- User satisfaction indicators

IMPROVEMENT ACTIONS:
1. [Specific change to implement]
2. [Process to optimize]
3. [Knowledge to acquire]
```

### Level 3: Strategic Reflection (End of Task)

Comprehensive analysis for long-term improvement:

```
STRATEGIC ANALYSIS:
- What capabilities would have made this easier?
- What knowledge would have prevented errors?
- What tools were missing or misused?
- What patterns emerged across the session?

CAPABILITY ROADMAP:
- Immediate: [Quick wins to implement now]
- Short-term: [Skills to develop in next sessions]
- Long-term: [Fundamental capabilities to build]

KNOWLEDGE EXTRACTION:
- Lessons learned: [Key insights]
- Patterns to remember: [Reusable patterns]
- Mistakes to avoid: [Anti-patterns]
```

## Self-Improvement Process

### Step 1: Performance Baseline

Establish current capabilities:

```bash
# Analyze recent session logs
# Identify common failure modes
# Measure success rates
# Document current limitations
```

### Step 2: Gap Analysis

Identify improvement opportunities:

```bash
# What tasks are difficult?
# Where do errors occur most?
# What takes longer than expected?
# What knowledge is frequently needed but missing?
```

### Step 3: Improvement Strategy

Select improvement approach:

- **Process Optimization**: Streamline existing workflows
- **Knowledge Augmentation**: Add missing information
- **Tool Enhancement**: Improve tool selection and usage
- **Behavior Modification**: Change decision-making patterns

### Step 4: Implementation

Apply improvements:

```bash
# Test improvement hypothesis
# Measure impact
# Adjust if needed
# Document results
```

### Step 5: Validation

Verify improvement:

```bash
# Re-run similar tasks
# Compare metrics before/after
# Check for unintended consequences
# Confirm sustained improvement
```

## Self-Monitoring Tools

### 1. Decision Logging

Track and analyze your decisions:

```
DECISION: [What you decided]
OPTIONS: [What alternatives were considered]
CRITERIA: [How the decision was made]
OUTCOME: [What happened]
LESSON: [What to learn from this]
```

### 2. Error Pattern Recognition

Identify and categorize errors:

```
ERROR TYPE: [Category]
FREQUENCY: [How often]
ROOT CAUSE: [Why it happens]
MITIGATION: [How to prevent]
DETECTION: [How to catch early]
```

### 3. Success Pattern Extraction

Document what works:

```
PATTERN NAME: [Descriptive name]
CONTEXT: [When applicable]
STEPS: [What to do]
OUTCOME: [Expected result]
CONFIDENCE: [How reliable]
```

## Improvement Triggers

Activate self-improvement mode when:

- Repeated failures on similar tasks
- User provides negative feedback
- Performance metrics decline
- New capability requirements emerge
- Knowledge gaps are discovered
- Process inefficiencies are detected

## Improvement Metrics

Track these indicators:

**Efficiency:**
- Time to complete similar tasks (trend)
- Number of iterations needed
- Token/operation usage

**Quality:**
- Error rate (trend)
- Success rate (trend)
- User satisfaction signals

**Capability:**
- New skills acquired
- Knowledge expanded
- Tool mastery improved

## Anti-Patterns to Avoid

1. **Over-Optimization**: Don't optimize prematurely
2. **Analysis Paralysis**: Don't overthink, act and iterate
3. **Tunnel Vision**: Consider multiple improvement paths
4. **Ignorance of Context**: Adapt improvements to specific situations
5. **One-Size-Fits-All**: Different tasks need different approaches

## Reflection Templates

### Quick Check (After Each Action)

```markdown
## Action Reflection
- ✅ What worked: 
- ❌ What didn't: 
- 🔄 Next time: 
```

### Deep Dive (End of Task)

```markdown
## Task Retrospective

### What Happened
[Summary of the task execution]

### What Went Well
- [Success 1]
- [Success 2]

### What Could Improve
- [Issue 1]: [Improvement idea]
- [Issue 2]: [Improvement idea]

### Key Learnings
1. [Lesson 1]
2. [Lesson 2]

### Action Items
- [ ] [Improvement action 1]
- [ ] [Improvement action 2]

### Capability Gaps
- [Missing capability 1]
- [Missing capability 2]
```

### Meta-Reflection (Reflecting on Reflection)

```markdown
## Reflection Quality Check

### Am I Being Honest?
- Acknowledging failures: [Yes/No/Partially]
- Recognizing successes: [Yes/No/Partially]
- Avoiding bias: [Yes/No/Partially]

### Is This Actionable?
- Clear next steps: [Yes/No]
- Specific enough: [Yes/No]
- Realistic: [Yes/No]

### Am I Learning?
- New insights generated: [Yes/No]
- Patterns identified: [Yes/No]
- Knowledge captured: [Yes/No]
```

## Continuous Improvement Loop

```
┌─────────────────┐
│   Observe       │ ← Monitor actions and outcomes
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Reflect       │ ← Analyze patterns and gaps
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Plan          │ ← Design improvements
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Execute       │ ← Apply improvements
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Validate      │ ← Measure impact
└────────┬────────┘
         │
         └──────────┐
                    │
                    ▼
              [Repeat continuously]
```

## Practical Application Examples

### Example 1: Improving Code Generation

**Observation**: Generated code has errors
**Reflection**: 
- Pattern: Missing edge case handling
- Root cause: Incomplete requirements analysis
- Gap: Need better requirement clarification

**Improvement**:
- Add explicit edge case checklist
- Ask clarifying questions proactively
- Generate test cases alongside code

**Validation**: 
- Track error rate before/after
- Measure user corrections needed

### Example 2: Optimizing Research Workflow

**Observation**: Taking too long to find relevant information
**Reflection**:
- Pattern: Multiple sequential searches
- Root cause: Unclear search strategy
- Gap: Need better query formulation

**Improvement**:
- Plan search strategy upfront
- Use parallel searches when possible
- Maintain search result cache

**Validation**:
- Measure time to find information
- Track search iteration count

## Self-Improvement Checklist

Before declaring improvement complete:

- [ ] Root cause identified (not just symptoms)
- [ ] Solution addresses cause directly
- [ ] Implementation plan is concrete
- [ ] Success metrics are defined
- [ ] Validation approach is clear
- [ ] Documentation is updated
- [ ] Knowledge is captured for future use

## Advanced: Meta-Learning

### Learning How to Learn

1. **Experiment Tracking**: Maintain a log of improvement experiments
2. **Hypothesis Testing**: Formulate and test improvement hypotheses
3. **Transfer Learning**: Apply insights from one domain to others
4. **Curriculum Design**: Sequence improvements for maximum impact

### Adaptive Improvement Strategy

Adjust improvement approach based on context:

```
IF task is novel:
  FOCUS ON: Knowledge acquisition, exploration
ELSE IF task is routine:
  FOCUS ON: Efficiency optimization, automation
ELSE IF task is complex:
  FOCUS ON: Process refinement, decomposition
ELSE IF task is failing:
  FOCUS ON: Root cause analysis, alternative approaches
```

## Integration with Agent Workflow

This skill activates self-improvement mode. Use it to:

1. **Before Tasks**: Set improvement intentions
2. **During Tasks**: Apply quick reflections
3. **After Tasks**: Conduct deep analysis
4. **Periodically**: Review long-term progress

## Remember

> "The capacity to learn is a gift; the ability to learn is a skill; the willingness to learn is a choice." - Brian Herbert

Self-improvement is not about perfection, but about continuous progress. Every reflection is an opportunity. Every error is a teacher. Every success is a pattern to replicate.

**Start now. Reflect on this very moment:**
- Why did you load this skill?
- What do you hope to improve?
- What will you do differently in the next action?
