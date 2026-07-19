import { describe, expect, it } from 'vitest';
import {
  ACTION_REQUEST_TOOL,
  ACTION_REQUEST_TOOL_NAME,
  actionRequestFromToolCall,
  formatActionRequests,
  formatMessagePayload,
} from './action-request.js';
import type { ToolCall } from '../types/tool.js';

const call = (name: string, argumentsString: string): ToolCall => ({
  id: 'call-1',
  type: 'function',
  function: { name, arguments: argumentsString },
});

describe('action requests', () => {
  it('defines the optional action-request tool contract', () => {
    expect(ACTION_REQUEST_TOOL.name).toBe(ACTION_REQUEST_TOOL_NAME);
    expect(ACTION_REQUEST_TOOL.parameters).toEqual(
      expect.objectContaining({ additionalProperties: false }),
    );
  });

  it('converts valid tool calls into trimmed structured requests', () => {
    expect(
      actionRequestFromToolCall(
        call(
          ACTION_REQUEST_TOOL_NAME,
          JSON.stringify({
            targetNodeId: ' tool-files ',
            operation: ' list_directory ',
            arguments: { path: '.' },
          }),
        ),
      ),
    ).toEqual({
      id: 'call-1',
      targetNodeId: 'tool-files',
      operation: 'list_directory',
      arguments: { path: '.' },
    });
  });

  it('ignores unrelated, malformed, and incomplete tool calls', () => {
    expect(actionRequestFromToolCall(call('other', '{}'))).toBeUndefined();
    expect(
      actionRequestFromToolCall(call(ACTION_REQUEST_TOOL_NAME, '{bad json')),
    ).toBeUndefined();

    const invalidArguments = [
      null,
      [],
      {},
      { targetNodeId: '', operation: 'run', arguments: {} },
      { targetNodeId: 1, operation: 'run', arguments: {} },
      { targetNodeId: 'tool', operation: '', arguments: {} },
      { targetNodeId: 'tool', operation: 1, arguments: {} },
      { targetNodeId: 'tool', operation: 'run', arguments: [] },
    ];
    invalidArguments.forEach((value) => {
      expect(
        actionRequestFromToolCall(
          call(ACTION_REQUEST_TOOL_NAME, JSON.stringify(value)),
        ),
      ).toBeUndefined();
    });
  });

  it('formats requests for model and selection context', () => {
    expect(formatActionRequests(undefined)).toBe('');
    expect(formatActionRequests([])).toBe('');
    expect(
      formatActionRequests([
        {
          id: 'request-1',
          targetNodeId: 'goal-manager',
          operation: 'clear_active_goal',
          arguments: { goalId: 'goal-1' },
        },
      ]),
    ).toBe(
      '[ACTION REQUEST request-1] target=goal-manager operation=clear_active_goal arguments={"goalId":"goal-1"}',
    );
  });

  it('formats message prose and actions without blank separators', () => {
    expect(formatMessagePayload({ content: 'Think first.' })).toBe(
      'Think first.',
    );
    expect(
      formatMessagePayload({
        content: '',
        actionRequests: [
          {
            id: 'request-2',
            targetNodeId: 'clock',
            operation: 'read',
            arguments: {},
          },
        ],
      }),
    ).toBe(
      '[ACTION REQUEST request-2] target=clock operation=read arguments={}',
    );
  });
});
