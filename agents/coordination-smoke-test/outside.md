# Coordination Smoke Test — outside contract

This agent is driven by an outside peer that wants proof the coordination loop works end to end.

## Before running

Start the run first in another terminal or background shell, then capture the active run id:

```bash
npx minih run coordination-smoke-test
RUN_ID=$(minih status coordination-smoke-test 2>/dev/null | jq -r '.data.runId')
```

Send a request to that run:

```bash
npx minih outside-send coordination-smoke-test \
  --run "$RUN_ID" \
  --subject "Smoke test request" \
  --body "Please acknowledge this message, update inside state, and report back."
```

Optionally publish outside progress:

```bash
npx minih state set coordination-smoke-test \
  --run "$RUN_ID" \
  --side outside \
  --status in-progress \
  --data-json '{"driver":"outside smoke test"}'
```

## Expected inside behavior

The inside agent should use `inbox_list`, `inbox_ack`, `inbox_send`, `state_get`, `state_set`, and `state_transition`. After the run, inspect replies with `minih outside-inbox-list coordination-smoke-test --run "$RUN_ID"` and state with `minih state get coordination-smoke-test --run "$RUN_ID"`.
