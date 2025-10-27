import { OpenAiAgentDaemon } from './openai-agent-daemon.js';
import type { DaemonIdentity } from '../types/daemon.js';
import type { Agent, SystemMessageItem } from '@openai/agents';

const mockContextFormatter = {
  format: jest.fn().mockResolvedValue('compiled-context'),
};

const mockAgentMessagePostProcessor = {
  transform: jest.fn().mockImplementation((output) => output),
};

const mockRunFn = jest.fn().mockResolvedValue({
  output: [{ role: 'assistant', content: 'processed-output' }],
  finalOutput: 'final-result',
});

const dummyIdentity: DaemonIdentity = {
  id: 'daemon-1',
  name: 'TestDaemon',
  description: 'A test daemon',
};

const dummyAgent = {} as unknown as Agent;
const dummyInstructions = 'Perform task';
const dummyContextProviders: [] = [];

describe('OpenAiAgentDaemon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('processes a single epoch correctly', async () => {
    const daemon = new OpenAiAgentDaemon({
      identity: dummyIdentity,
      agent: dummyAgent,
      instructions: dummyInstructions,
      contextFormatter: mockContextFormatter,
      contextProviders: dummyContextProviders,
      agentMessagePostProcessor: mockAgentMessagePostProcessor,
      runFn: mockRunFn,
    });

    const result = await daemon.nextEpoch();

    expect(mockContextFormatter.format).toHaveBeenCalledWith(
      [],
      dummyContextProviders,
    );

    const expectedSystemMessage: SystemMessageItem = {
      role: 'system',
      type: 'message',
      content: `You are ${dummyIdentity.name} (agent ID ${dummyIdentity.id}). Current Context: compiled-context`,
    };
    expect(mockRunFn).toHaveBeenCalledWith(dummyAgent, [
      expectedSystemMessage,
      {
        role: 'user',
        type: 'message',
        content: dummyInstructions,
      },
    ]);

    expect(mockAgentMessagePostProcessor.transform).toHaveBeenCalledWith([
      { role: 'assistant', content: 'processed-output' },
    ]);
    expect(daemon.history).toEqual([
      { role: 'assistant', content: 'processed-output' },
    ]);

    expect(result).toBe('final-result');
  });

  it('includes previous epoch output in subsequent context formatting', async () => {
    const daemon = new OpenAiAgentDaemon({
      identity: dummyIdentity,
      agent: dummyAgent,
      instructions: dummyInstructions,
      contextFormatter: mockContextFormatter,
      contextProviders: dummyContextProviders,
      agentMessagePostProcessor: mockAgentMessagePostProcessor,
      runFn: mockRunFn,
    });

    await daemon.nextEpoch();
    await daemon.nextEpoch();

    expect(mockContextFormatter.format).toHaveBeenCalledTimes(2);
    const firstCallArgs = (mockContextFormatter.format as jest.Mock).mock
      .calls[0];
    const secondCallArgs = (mockContextFormatter.format as jest.Mock).mock
      .calls[1];
    expect(firstCallArgs[0]).toEqual([]);
    expect(secondCallArgs[0]).toEqual([
      { role: 'assistant', content: 'processed-output' },
    ]);
  });

  it('returns default string when finalOutput is missing', async () => {
    const mockRunFnNoFinal = jest.fn().mockResolvedValue({
      output: [{ role: 'assistant', content: 'processed-output' }],
    });

    const daemon = new OpenAiAgentDaemon({
      identity: dummyIdentity,
      agent: dummyAgent,
      instructions: dummyInstructions,
      contextFormatter: mockContextFormatter,
      contextProviders: dummyContextProviders,
      agentMessagePostProcessor: mockAgentMessagePostProcessor,
      runFn: mockRunFnNoFinal,
    });

    const result = await daemon.nextEpoch();

    expect(result).toBe('<Agent generated no output>');

    expect(daemon.history).toEqual([
      { role: 'assistant', content: 'processed-output' },
    ]);
  });
});
