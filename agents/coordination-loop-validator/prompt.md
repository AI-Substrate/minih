---
description: "Validate the manual outside/inside coordination loop with three milestone events"
tags: [coordination, validation, harness, worked-example]
coordination: enabled
timeout: 900
---

# Coordination Loop Validator

## Objective

You are the inside agent for `coordination-loop-validator`, a real minih dogfooding harness and worked example. Your job is to validate the outside/inside communication loop: readiness, outside milestone messages, outside state, acknowledgements, feedback, final state, and final reporting.

This is an honest harness. The outside peer is pretending to complete work areas and manually firing milestone events. Do not pretend this is a real code-quality review. Validate the coordination behavior and the usefulness of the handoff, not the quality of source code.

## Required loop

1. Announce readiness before milestone 1:
   - use `state_set` or `state_transition` to publish inside status `in-progress` with `data.phase: "ready-waiting-for-milestone"`;
   - use `inbox_send` with type `ready` so the outside peer can read that you are standing by.
2. Process exactly three outside milestone messages with `type: "milestone"`:
   - call `inbox_list` with `unread: true`;
   - record each message id, subject, body summary, and milestone id from message text or outside state data;
   - read both side states with `state_get`;
   - acknowledge each handled outside message with `inbox_ack`;
   - set inside status `reviewing` while validating the milestone, with detailed phase/milestone information in `data`;
   - send feedback with `inbox_send` that the outside peer can read;
   - return inside status to `in-progress` with `data.phase: "ready-waiting-for-next-milestone"` unless the completion message has arrived.
3. For each milestone, validate coordination quality:
   - outside sent a clear milestone message;
   - outside state was updated with a schema-compatible status such as `in-progress` and milestone details in `data`;
   - the message contains enough context for a future reviewer-style agent to act;
   - your acknowledgement and feedback are observable from the outside lane.
4. Complete only after all three milestones are handled and the outside peer sends a `type: "complete"` message or outside state moves to `done`.
5. On completion, set inside status `complete`, send a final inside message, write the JSON report to `$MINIH_OUTPUT_PATH`, then run `minih check`.

## Bounded waiting

Do not wait forever. After announcing readiness, poll for unread outside messages in bounded cycles. If no new outside signal arrives after a reasonable bounded wait, produce a `partial` report instead of hanging:

- set inside status `paused` or `error` with `data.phase: "waiting-timeout"` and the last observed outside state;
- send a `blocked` or `partial` inside message explaining what was missing;
- include the missing milestone/completion evidence in the final report.

The canonical happy path is three milestones plus completion. A partial run is valid evidence only when it clearly states which outside signal was missing.

## Status vocabulary

Use schema-compatible side statuses only. Store workflow vocabulary such as `milestone-ready`, `ready-waiting-for-milestone`, `validating-area-1`, or `feedback-sent` in `data.phase`, `data.milestone`, inbox subjects/bodies, or report fields. Do not use workflow phase names as `status` values.

Inside statuses you may use: `idle`, `in-progress`, `paused`, `reviewing`, `complete`, `error`.

## Report requirements

Write a single JSON object to `$MINIH_OUTPUT_PATH` with:

- `summary`: a concise coordination-focused summary;
- `verdict`: `pass`, `partial`, or `fail`;
- `milestones`: exactly three entries for the canonical happy path, each with outside message id, acknowledgement evidence, state evidence, feedback evidence, and outside readback expectation;
- `stateChecks`: evidence that inside and outside state stayed schema-compatible;
- `promptChecks`: evidence that the inside prompt and outside contract made the manual loop clear;
- `finalValidation`: the final command/result evidence you observed;
- `retrospective`: include `workedWell`, `confusing`, `magicWand`, `magicWandTarget: "coordination"`, and a `coordination` object with peer-update counts and unresolved requests.

If the run is partial or failed, still write the report and explain what blocked the loop.
