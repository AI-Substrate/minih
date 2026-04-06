# Code Review Instructions

## Review Process

1. Start by understanding what changed and why (read commits, plan, spec)
2. Read every changed file in full — understand context
3. Check domain compliance against domain docs
4. Look for reinvention of existing patterns
5. Verify test coverage against acceptance criteria
6. Produce structured findings ordered by severity

## Severity Guide

- **CRITICAL**: Security vulnerability, data loss risk, broken contract
- **HIGH**: Functional bug, missing error handling for common path, AC not met
- **MEDIUM**: Edge case not handled, incomplete docs, weak test coverage
- **LOW**: Minor improvement, documentation nit, style inconsistency

## Verdict Rules

- Zero HIGH/CRITICAL → **APPROVE**
- Any HIGH/CRITICAL with reasonable mitigations → **APPROVE_WITH_NOTES**
- Any unmitigated HIGH/CRITICAL → **REQUEST_CHANGES**

## Output

Write structured JSON to $MINIH_OUTPUT_PATH with verdict, findings array, domain compliance status, coverage map, and retrospective.
