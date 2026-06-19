/**
 * Metric instrument definitions — lazy meter acquisition.
 *
 * Instruments are created on first use (not at import time) so that
 * the MeterProvider registered by initTelemetry() is available.
 * When telemetry is disabled, the API returns no-op instruments (zero overhead).
 */

import {
  type Attributes,
  type Counter,
  type Histogram,
  metrics,
} from '@opentelemetry/api';

function getMeter() {
  return metrics.getMeter('minih');
}

/** Agent run duration in milliseconds. */
let _runDuration: Histogram | undefined;
export const runDuration = {
  record(value: number, attrs?: Attributes) {
    if (!_runDuration) {
      _runDuration = getMeter().createHistogram('minih.run.duration', {
        description: 'Agent run duration',
        unit: 'ms',
      });
    }
    _runDuration.record(value, attrs);
  },
};

/** Total agent runs (with result attribute: completed/failed/timeout). */
let _runCount: Counter | undefined;
export const runCount = {
  add(value: number, attrs?: Attributes) {
    if (!_runCount) {
      _runCount = getMeter().createCounter('minih.run.count', {
        description: 'Total agent runs',
        unit: '{runs}',
      });
    }
    _runCount.add(value, attrs);
  },
};

/** Tool calls per run. */
let _toolCallCount: Histogram | undefined;
export const toolCallCount = {
  record(value: number, attrs?: Attributes) {
    if (!_toolCallCount) {
      _toolCallCount = getMeter().createHistogram('minih.run.tool_calls', {
        description: 'Tool calls per run',
        unit: '{calls}',
      });
    }
    _toolCallCount.record(value, attrs);
  },
};

/** Total events emitted. */
let _eventCount: Counter | undefined;
export const eventCount = {
  add(value: number, attrs?: Attributes) {
    if (!_eventCount) {
      _eventCount = getMeter().createCounter('minih.run.events', {
        description: 'Total events emitted',
        unit: '{events}',
      });
    }
    _eventCount.add(value, attrs);
  },
};

/** Validation attempts (with valid attribute). */
let _validationCount: Counter | undefined;
export const validationCount = {
  add(value: number, attrs?: Attributes) {
    if (!_validationCount) {
      _validationCount = getMeter().createCounter('minih.validation.count', {
        description: 'Validation attempts',
        unit: '{validations}',
      });
    }
    _validationCount.add(value, attrs);
  },
};

/** Assembled prompt token count. */
let _promptTokens: Histogram | undefined;
export const promptTokens = {
  record(value: number, attrs?: Attributes) {
    if (!_promptTokens) {
      _promptTokens = getMeter().createHistogram('minih.prompt.tokens', {
        description: 'Assembled prompt token count',
        unit: '{tokens}',
      });
    }
    _promptTokens.record(value, attrs);
  },
};

/** SDK session active duration in milliseconds. */
let _sessionDuration: Histogram | undefined;
export const sessionDuration = {
  record(value: number, attrs?: Attributes) {
    if (!_sessionDuration) {
      _sessionDuration = getMeter().createHistogram(
        'minih.adapter.session_duration',
        {
          description: 'SDK session active duration',
          unit: 'ms',
        },
      );
    }
    _sessionDuration.record(value, attrs);
  },
};

/** Coordination inbox messages sent (attrs: type, sender). */
let _coordinationMessagesSent: Counter | undefined;
export const coordinationMessagesSent = {
  add(value: number, attrs?: Attributes) {
    if (!_coordinationMessagesSent) {
      _coordinationMessagesSent = getMeter().createCounter(
        'minih.coordination.messages_sent',
        {
          description: 'Coordination inbox messages sent',
          unit: '{messages}',
        },
      );
    }
    _coordinationMessagesSent.add(value, attrs);
  },
};

/** Coordination inbox messages delivered to the inside agent (attrs: type). */
let _coordinationMessagesReceived: Counter | undefined;
export const coordinationMessagesReceived = {
  add(value: number, attrs?: Attributes) {
    if (!_coordinationMessagesReceived) {
      _coordinationMessagesReceived = getMeter().createCounter(
        'minih.coordination.messages_received',
        {
          description: 'Coordination inbox messages delivered to the agent',
          unit: '{messages}',
        },
      );
    }
    _coordinationMessagesReceived.add(value, attrs);
  },
};

/** Coordination inside-state transitions (attrs: from, to). */
let _coordinationStateTransitions: Counter | undefined;
export const coordinationStateTransitions = {
  add(value: number, attrs?: Attributes) {
    if (!_coordinationStateTransitions) {
      _coordinationStateTransitions = getMeter().createCounter(
        'minih.coordination.state_transitions',
        {
          description: 'Coordination inside-state transitions',
          unit: '{transitions}',
        },
      );
    }
    _coordinationStateTransitions.add(value, attrs);
  },
};
