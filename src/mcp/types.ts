import type { Side } from '../runner/types.js';

export const MINIH_COORDINATION_SERVER_NAME = 'minih-coordination';

export const MCP_TOOL_NAMES = [
  'inbox.list',
  'inbox.send',
  'inbox.ack',
  'state.get',
  'state.set',
  'state.transition',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export type McpErrorCode =
  | 'MCP_CONTEXT_INVALID'
  | 'MCP_INBOX_CORRUPT'
  | 'MCP_INVALID_ARGUMENT'
  | 'MCP_NOT_FOUND'
  | 'MCP_CONFLICT'
  | 'MCP_STATE_CORRUPT'
  | 'MCP_STATE_SCHEMA_INVALID'
  | 'MCP_HISTORY_TOO_LARGE'
  | 'MCP_INTERNAL_ERROR';

export interface McpErrorMeta {
  code: McpErrorCode;
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpToolResult<TStructured = unknown> {
  content: McpTextContent[];
  structuredContent?: TStructured;
  _meta?: McpErrorMeta & Record<string, unknown>;
  isError?: boolean;
}

export class McpToolError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

export function jsonResult<TStructured>(
  structuredContent: TStructured,
): McpToolResult<TStructured> {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
  };
}

export function errorResult(error: McpToolError): McpToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: error.message }],
    _meta: { code: error.code },
  };
}

export type JsonSchema =
  | { type: 'boolean'; description?: string; default?: boolean }
  | {
      type: 'integer';
      description?: string;
      minimum?: number;
      maximum?: number;
    }
  | { type: 'number'; description?: string; minimum?: number; maximum?: number }
  | {
      type: 'string';
      description?: string;
      minLength?: number;
      maxLength?: number;
    }
  | {
      type: 'object';
      description?: string;
      properties?: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean;
    };

export interface ToolContract {
  name: McpToolName;
  description: string;
  inputSchema: Extract<JsonSchema, { type: 'object' }>;
}

export interface InboxListInput {
  unread?: boolean;
  type?: string;
  limit?: number;
  after?: string;
}

export interface InboxSendInput {
  subject: string;
  body: string;
  type?: string;
  meta?: Record<string, unknown>;
}

export interface InboxAckInput {
  msgId: string;
}

export interface StateGetInput {
  side?: Side | 'self' | 'peer' | 'both';
  key?: string;
}

export interface StateSetInput {
  status: string;
  data?: Record<string, unknown>;
}

export interface StateTransitionInput {
  to: string;
  reason?: string | null;
  data?: Record<string, unknown>;
}

const sideSchema: JsonSchema = {
  type: 'string',
  description:
    'State side to inspect: self/inside, peer/outside, or both. Defaults to both.',
};

export const TOOL_CONTRACTS: readonly ToolContract[] = [
  {
    name: 'inbox.list',
    description: 'List messages visible to the inside agent.',
    inputSchema: {
      type: 'object',
      properties: {
        unread: {
          type: 'boolean',
          description: 'When true, exclude messages acknowledged by this side.',
          default: false,
        },
        type: {
          type: 'string',
          description: 'When set, return only messages with this exact type.',
          minLength: 1,
          maxLength: 64,
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of messages to return.',
          minimum: 1,
          maximum: 200,
        },
        after: {
          type: 'string',
          description: 'Return messages after this message id.',
          minLength: 1,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'inbox.send',
    description: 'Send an append-only inbox message from the inside side.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', minLength: 1, maxLength: 200 },
        body: { type: 'string', minLength: 1, maxLength: 16000 },
        type: {
          type: 'string',
          description: "Short message kind; defaults to 'note'.",
          minLength: 1,
          maxLength: 64,
        },
        meta: { type: 'object', additionalProperties: true },
      },
      required: ['subject', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'inbox.ack',
    description: 'Acknowledge a peer inbox message by id.',
    inputSchema: {
      type: 'object',
      properties: {
        msgId: { type: 'string', minLength: 1, maxLength: 128 },
      },
      required: ['msgId'],
      additionalProperties: false,
    },
  },
  {
    name: 'state.get',
    description: 'Read inside or outside state.',
    inputSchema: {
      type: 'object',
      properties: {
        side: sideSchema,
        key: {
          type: 'string',
          description:
            "Optional dot-path to read from the selected state, e.g. 'status' or 'data.phase'.",
          minLength: 1,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'state.set',
    description: 'Set the inside state data and status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', minLength: 1, maxLength: 128 },
        data: { type: 'object', additionalProperties: true },
      },
      required: ['status'],
      additionalProperties: false,
    },
  },
  {
    name: 'state.transition',
    description: 'Transition inside state status and append history.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', minLength: 1, maxLength: 128 },
        reason: { type: 'string', maxLength: 2000 },
        data: { type: 'object', additionalProperties: true },
      },
      required: ['to'],
      additionalProperties: false,
    },
  },
] as const;

export function isMcpToolName(name: string): name is McpToolName {
  return (MCP_TOOL_NAMES as readonly string[]).includes(name);
}
