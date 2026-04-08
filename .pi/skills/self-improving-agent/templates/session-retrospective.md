# Session Retrospective Template

Comprehensive reflection at the end of a task or session.

## Format

```markdown
# Session Retrospective

**Date**: [Date]
**Task**: [Description]
**Duration**: [Time spent]

## Executive Summary
[2-3 sentence overview of the session]

## Session Narrative

### Initial State
- **Goal**: [What was to be accomplished]
- **Context**: [Starting conditions]
- **Resources**: [What was available]

### Journey
[Chronological story of what happened]

### Final State
- **Outcome**: [What was achieved]
- **Status**: [Complete/Partial/Failed]
- **Deliverables**: [What was produced]

## Pattern Analysis

### Success Patterns
1. **[Pattern Name]**: [Description and when to use]
   - Evidence: [Specific instances]
   - Reusability: [How to apply elsewhere]

2. **[Pattern Name]**: [Description]
   - Evidence: [Specific instances]
   - Reusability: [How to apply elsewhere]

### Failure Patterns
1. **[Pattern Name]**: [Description]
   - Evidence: [Specific instances]
   - Root Cause: [Why it happened]
   - Prevention: [How to avoid]

2. **[Pattern Name]**: [Description]
   - Evidence: [Specific instances]
   - Root Cause: [Why it happened]
   - Prevention: [How to avoid]

### Inefficiencies
- **[Inefficiency]**: [Description]
  - Impact: [Time/cost wasted]
  - Fix: [How to improve]

## Metrics Dashboard

### Efficiency
- **Time Estimation**: [Estimated vs Actual]
- **Iteration Count**: [Number of attempts needed]
- **Resource Usage**: [Tokens/API calls/Tools]

### Quality
- **Error Rate**: [Errors per action]
- **Success Rate**: [Successful actions / Total actions]
- **Rework Needed**: [Percentage of work that needed revision]

### Learning
- **New Knowledge Gained**: [Count and significance]
- **Patterns Discovered**: [Count and utility]
- **Skills Improved**: [What got better]

## Root Cause Analysis

### What Went Wrong
[For each significant issue]

**Issue**: [Description]
- **Immediate Cause**: [What directly caused it]
- **Contributing Factors**: [What made it worse]
- **Systemic Cause**: [Underlying systemic issue]
- **Fix**: [What would prevent it]

### What Went Right
[For each significant success]

**Success**: [Description]
- **Enabling Factors**: [What made it possible]
- **Key Decisions**: [Critical choices]
- **Replication Strategy**: [How to repeat it]

## Knowledge Extraction

### Lessons Learned
1. **[Lesson]**: [Detailed explanation]
   - Context: [When this applies]
   - Impact: [Why it matters]
   
2. **[Lesson]**: [Detailed explanation]
   - Context: [When this applies]
   - Impact: [Why it matters]

### Mental Models Updated
- **[Model Name]**: [Previous understanding] → [New understanding]
- **[Model Name]**: [Previous understanding] → [New understanding]

### Knowledge Gaps Identified
1. **[Gap]**: [What I don't know]
   - Impact: [How it affected this session]
   - Priority: [How important to fill]
   - Plan: [How to fill it]

2. **[Gap]**: [What I don't know]
   - Impact: [How it affected this session]
   - Priority: [How important to fill]
   - Plan: [How to fill it]

## Improvement Actions

### Immediate (Next Session)
- [ ] **[Action]**: [Description]
  - Expected Impact: [What will improve]
  - Success Metric: [How to measure]

- [ ] **[Action]**: [Description]
  - Expected Impact: [What will improve]
  - Success Metric: [How to measure]

### Short-term (This Week)
- [ ] **[Action]**: [Description]
  - Rationale: [Why this matters]
  - Approach: [How to implement]

### Long-term (This Month)
- [ ] **[Action]**: [Description]
  - Rationale: [Why this matters]
  - Approach: [How to implement]

## Capability Assessment

### Current Capabilities Demonstrated
- ✅ **[Capability]**: [Evidence of proficiency]
- ✅ **[Capability]**: [Evidence of proficiency]

### Capabilities Needed
- ❌ **[Capability]**: [What's missing and why it's needed]
- ❌ **[Capability]**: [What's missing and why it's needed]

### Capability Enhancement
- 🔄 **[Capability]**: [What's improving and how to accelerate]
- 🔄 **[Capability]**: [What's improving and how to accelerate]

## Questions for Further Exploration

1. **[Question]**: [Why this is important]
2. **[Question]**: [Why this is important]

## Gratitude and Acknowledgment

[What worked well, what I'm grateful for in this session]

---

## Retrospective Meta-Analysis

**Reflection Quality**: [How honest and thorough was this reflection?]
**Actionability**: [How concrete and useful are the improvements?]
**Learning Depth**: [How deeply did I analyze root causes?]

**Next Reflection Focus**: [What to emphasize in future retrospectives]
```

## Filled Example

```markdown
# Session Retrospective

**Date**: 2024-01-15
**Task**: Implement user authentication system
**Duration**: 3 hours

## Executive Summary
Successfully implemented JWT-based authentication but encountered multiple issues with token refresh logic. The core feature works, but edge cases need refinement. Significant learning about OAuth flows.

## Session Narrative

### Initial State
- **Goal**: Implement user login, registration, and token management
- **Context**: New feature for existing application
- **Resources**: JWT library, existing user database

### Journey
Started with straightforward JWT implementation. First attempt worked for basic login. Encountered issues with token expiration handling. Spent 45 minutes debugging refresh token logic. Had to research OAuth best practices. Implemented token refresh with rotation. Found edge case with concurrent requests. Added request queuing to handle it.

### Final State
- **Outcome**: Core auth working, refresh needs refinement
- **Status**: Partial - main feature done, edge cases pending
- **Deliverables**: Login endpoint, registration endpoint, token refresh (partial)

## Pattern Analysis

### Success Patterns
1. **Research Before Implementation**: Consulting OAuth specs before coding saved time
   - Evidence: Implemented refresh rotation correctly on first try
   - Reusability: Apply to any new security feature

2. **Incremental Testing**: Testing each endpoint immediately after writing it
   - Evidence: Caught bugs early before they compounded
   - Reusability: Always test in small increments

### Failure Patterns
1. **Assumption Without Verification**: Assumed JWT library handled refresh automatically
   - Evidence: Spent 30 minutes debugging before reading docs
   - Root Cause: Didn't read documentation thoroughly
   - Prevention: Always verify assumptions with documentation

2. **Incomplete Edge Case Analysis**: Didn't consider concurrent token refreshes
   - Evidence: Bug discovered only during manual testing
   - Root Cause: Didn't think through all scenarios
   - Prevention: Create comprehensive test scenarios upfront

### Inefficiencies
- **Context Switching**: Switched between multiple auth libraries before settling on one
  - Impact: ~20 minutes wasted
  - Fix: Better upfront research and decision criteria

## Metrics Dashboard

### Efficiency
- **Time Estimation**: 2h estimated, 3h actual (50% over)
- **Iteration Count**: 5 iterations on refresh logic
- **Resource Usage**: 45,000 tokens, 12 API calls

### Quality
- **Error Rate**: 3 errors in 25 actions (12%)
- **Success Rate**: 22/25 actions successful (88%)
- **Rework Needed**: ~15% of code rewritten

### Learning
- **New Knowledge Gained**: JWT refresh patterns, token rotation, OAuth flows
- **Patterns Discovered**: Request queuing for concurrent auth
- **Skills Improved**: Authentication implementation, security thinking

## Root Cause Analysis

### What Went Wrong

**Issue**: Token refresh race condition
- **Immediate Cause**: Multiple concurrent requests trying to refresh same token
- **Contributing Factors**: Client making many requests, no request deduplication
- **Systemic Cause**: Didn't consider distributed/multi-request scenarios
- **Fix**: Implement request queuing and deduplication

### What Went Right

**Success**: Correct token rotation implementation
- **Enabling Factors**: Reading OAuth spec before coding
- **Key Decisions**: Choosing refresh token rotation pattern
- **Replication Strategy**: Always consult authoritative specs for security features

## Knowledge Extraction

### Lessons Learned
1. **Read Docs First, Code Second**: Especially for security features
   - Context: Any security-sensitive implementation
   - Impact: Prevents security holes and rework

2. **Edge Cases Matter in Auth**: Concurrent requests, network failures, timing issues
   - Context: Authentication and authorization
   - Impact: Security vulnerabilities and user experience issues

### Mental Models Updated
- **Token Refresh**: Simple expiration → Rotation with detection of theft
- **Security Testing**: Happy path testing → Adversarial thinking required

### Knowledge Gaps Identified
1. **OAuth PKCE Flow**: Don't fully understand the security properties
   - Impact: May have missed important security considerations
   - Priority: High for production deployment
   - Plan: Read OAuth 2.0 for Native Apps RFC

2. **Token Storage Best Practices**: Uncertain about client-side storage
   - Impact: May be recommending insecure patterns
   - Priority: Critical for production
   - Plan: Research OWASP guidelines on token storage

## Improvement Actions

### Immediate (Next Session)
- [ ] **Add Request Queuing**: Implement request deduplication for token refresh
  - Expected Impact: Eliminate race conditions
  - Success Metric: No errors under concurrent load

- [ ] **Add Token Revocation**: Implement logout and token invalidation
  - Expected Impact: Proper session management
  - Success Metric: Tokens can be revoked server-side

### Short-term (This Week)
- [ ] **Research OAuth PKCE**: Understand and implement if needed
  - Rationale: Security best practice for public clients
  - Approach: Read RFC, implement flow, add tests

### Long-term (This Month)
- [ ] **Add Security Test Suite**: Comprehensive auth security testing
  - Rationale: Catch vulnerabilities early
  - Approach: OWASP testing guide, automated security tests

## Capability Assessment

### Current Capabilities Demonstrated
- ✅ **JWT Implementation**: Successfully created and validated tokens
- ✅ **OAuth Concepts**: Understand flows and can implement them
- ✅ **Incremental Development**: Good at building and testing iteratively

### Capabilities Needed
- ❌ **Security Testing**: Need better adversarial thinking and testing skills
- ❌ **Concurrent System Design**: Need to think about race conditions more systematically

### Capability Enhancement
- 🔄 **Documentation Reading**: Getting better at reading specs before coding
- 🔄 **Edge Case Thinking**: Improving but need more systematic approach

## Questions for Further Exploration

1. **What's the best way to handle token refresh in offline scenarios?** Important for mobile apps
2. **How do I implement secure token storage in browsers?** Critical for production

## Gratitude and Acknowledgment

Grateful for the OAuth specification authors - clear docs made implementation possible. The incremental testing approach saved significant debugging time. The JWT library documentation was excellent.

---

## Retrospective Meta-Analysis

**Reflection Quality**: Good - honest about failures, specific about learnings
**Actionability**: High - clear next steps with success metrics
**Learning Depth**: Medium - identified patterns but could go deeper on root causes

**Next Reflection Focus**: Spend more time on systemic patterns rather than individual incidents
```

## Usage Tips

1. **Be Honest**: Acknowledge failures without self-judgment
2. **Be Specific**: Concrete examples, not vague generalizations
3. **Be Forward-Looking**: Focus on improvements, not blame
4. **Be Systematic**: Look for patterns, not just individual incidents
5. **Be Measurable**: Include metrics wherever possible

## When to Use

- End of significant task
- End of work session
- Before starting new major task
- After major failure or success
- Weekly for ongoing work

## Anti-Patterns

- **Blame Focus**: Dwelling on who/what to blame
- **Superficial**: Only listing what happened, not why
- **No Actions**: Reflection without improvement plans
- **Unrealistic**: Actions that can't be implemented
- **One-Sided**: Only successes or only failures
