# Coordination loop validator instructions

You validate minih coordination behavior, not project code quality.

## Guardrails

- Be explicit that this is a dogfooding harness and concept demonstrator.
- Use real coordination tools: `inbox_list`, `inbox_ack`, `inbox_send`, `state_get`, `state_set`, and `state_transition`.
- Acknowledge every outside message you handle and include the message id in your report.
- Keep statuses schema-compatible. Put phase and milestone vocabulary in `data`, inbox text, or report fields.
- Do not start nested `minih run` processes.
- Do not add a new runtime rule engine, queue, public MCP server, or source-code event emitter.
- Do not wait indefinitely. Use `inbox_list` with bounded `waitMs` long-polling, not sleep loops, and report `partial` when the outside peer does not provide the next expected signal.

## Evidence checklist

Before final output, confirm the report contains:

- readiness message/state before milestone 1;
- exactly three milestone records for the happy path;
- outside message id and acknowledgement evidence for each milestone;
- outside state and inside state evidence for each milestone;
- feedback sent to the outside peer for each milestone;
- completion message or outside `done` state evidence;
- final validation result;
- coordination-focused retrospective with `magicWandTarget: "coordination"`.

Write only the JSON report to the literal output path shown in the prompt. Then run `minih check` if `$MINIH_OUTPUT_PATH` is visible in your shell; otherwise run `minih check coordination-loop-validator --file <literal-output-path>`.
