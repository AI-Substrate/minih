# Coordination Smoke Test — outside contract

This agent is driven by an outside peer that wants proof the coordination loop works end to end.

## Before running

Send a request:

```bash
npx minih outside-send coordination-smoke-test \
  --subject "Smoke test request" \
  --body "Please acknowledge this message, update inside state, and report back."
```

Optionally publish outside progress:

```bash
npx minih state set coordination-smoke-test \
  --side outside \
  --status in-progress \
  --data-json '{"driver":"outside smoke test"}'
```

## Expected inside behavior

The inside agent should use `inbox.list`, `inbox.ack`, `inbox.send`, `state.get`, `state.set`, and `state.transition`. After the run, inspect replies with `minih outside-inbox-list coordination-smoke-test` and state with `minih state get coordination-smoke-test`.
