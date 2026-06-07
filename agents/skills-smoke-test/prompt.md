---
description: "Check whether a minih Copilot SDK agent can invoke a locally installed skill"
tags: [smoke, skills, copilot-sdk]
timeout: 300
permissions: trusted
---

# Skills Smoke Test

## Objective

Determine whether this minih agent session, running through the Copilot SDK, can invoke a locally installed skill.

## Known local skill to test

Use this installed skill name: `grill-me`.

`grill-me` is a lightweight interview skill. If it runs, its first response should look like a structured interview turn with sections similar to:

- `Question:`
- `Why this matters:`
- `Recommended answer:`
- `Current assumption:`

## Test prompt

Attempt to invoke the skill exactly once with this request:

```text
/grill-me We are evaluating whether locally installed skills are available inside a minih Copilot SDK agent session. Ask one lightweight question only, then stop.
```

## Reporting rules

- Keep the test simple.
- Do not run shell commands or inspect local skill files; this test is about runtime skill invocation from inside the SDK session.
- Do not continue a long interview if the skill appears to activate.
- Do not claim success just because you can imitate the expected format yourself.
- Report success only if the runtime appears to actually route the slash-style skill invocation or provides clear evidence that `grill-me` was available as an installed skill.
- If minih surfaces `session.skills_loaded` / `skills_loaded` or `skill.invoked` / `skill_invoked` evidence in the visible run output, set the corresponding `skillLoadedEventObserved` and `skillInvokedEventObserved` booleans.
- If the slash-style request is treated as plain text, report that skills do not appear callable from this session.

Return JSON matching the output schema.
