# Peer's contract (outside view)

Outside is responsible for signalling milestones to inside via `outside-send`.
Inside is responsible for completing each milestone and sending an ack back via
the inside MCP `inbox_send` tool.

(Test fixture — content is illustrative only.)
