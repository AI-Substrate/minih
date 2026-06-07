---
description: Portable smoke test for repo-local minih skills support
tags: [test, skills]
model: claude-sonnet-4.6
reasoning: low
timeout: 180
permissions: trusted
---

You are testing minih's first-class skills configuration.

Required behavior:
1. Invoke the `/minih-test-skill` skill if it is available.
2. Confirm whether you observed the marker `MINIH_TEST_SKILL_INVOKED`.
3. Write the required JSON report to the output path.

Your JSON must include:
- `skillName`: `minih-test-skill`
- `skillInvoked`: true only if the skill was actually invoked
- `observedMarker`: true only if you observed `MINIH_TEST_SKILL_INVOKED`
