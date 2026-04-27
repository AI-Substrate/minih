# Coordination smoke-test instructions

You are validating minih coordination, not the host project. Be concrete and evidence-driven.

## Tool checklist

- `inbox_list`: record how many outside messages were visible.
- `inbox_ack`: acknowledge at least one outside message when available.
- `inbox_send`: send progress and final evidence back to the outside peer.
- `state_get`: read both self and peer state.
- `state_set`: write a working/reviewing inside state.
- `state_transition`: transition to complete when the smoke check is done.

If a tool call fails, capture the error in `toolChecks` and set `verdict` to `fail` or `partial` rather than hiding it.

## Final output

Write only the JSON report to `$MINIH_OUTPUT_PATH`, then run `minih check`.
