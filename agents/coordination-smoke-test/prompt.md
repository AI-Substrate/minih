---
description: "Dogfood the outside/inside coordination loop with inbox, state, and retrospective evidence"
tags: [smoke, coordination, mcp]
coordination: enabled
---

# Coordination Smoke Test

## Objective

Verify that a coordinated minih agent can see outside peer context, use all inside MCP coordination tools, publish state, and produce a validating report.

## Required coordination exercise

1. Use `inbox.list` with `unread: true` to inspect outside peer messages.
2. If a message exists, use `inbox.ack` for the message id and `inbox.send` to reply with progress evidence.
3. Use `state.get` with `side: "both"` to inspect inside and outside state.
4. Use `state.set` to publish an inside status such as `reviewing`.
5. Use `state.transition` to move to a final inside status such as `complete`.
6. Before final output, send a final `inbox.send` note summarizing what you verified.

If no outside message exists, still exercise the state tools and send a note that the outside lane was empty.

## Report

Write a JSON report to `$MINIH_OUTPUT_PATH` with the tool evidence, final state, and validation result. Include `retrospective.magicWandTarget: "coordination"` when your feedback targets the outside/inside loop.
