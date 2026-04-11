---
description: Validate MCP tools are available in minih agent sessions
tags: [smoke, mcp, integration]
timeout: 300
---

# MCP Smoke Test

Verify that MCP servers configured for this project are loaded and their tools are callable.

## Steps

1. `cd $MINIH_PROJECT_ROOT`
2. Check if `.mcp.json` exists at the project root — record whether MCP config was found
3. List your available tools — look for `echo` and `add` tools from the test MCP server
4. Call the `echo` tool with message `"hello from minih"` — verify the response matches
5. Call the `add` tool with `a=2, b=3` — verify the result is `5`
6. Report pass/fail for each step

## Notes

- If no MCP config is found, report `mcpAvailable: false` and skip tool tests
- If tools are found but calls fail, still report what was found
- This agent validates the MCP config threading pipeline, not the MCP server itself
