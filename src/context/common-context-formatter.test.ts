import { CommonContextFormatter } from './common-context-formatter.js';
import { ContextProvider } from '../types/context.js';
import { AgentOutputItem } from '@openai/agents';

describe('CommonContextFormatter', () => {
  const formatter = CommonContextFormatter;

  const dummyProviders: Record<string, ContextProvider> = {
    providerA: {
      name: 'Provider A',
      description: 'First test provider',
      next: async (agentResponse: AgentOutputItem[]) =>
        `next-A-${JSON.stringify(agentResponse)}`,
    },
    providerB: {
      name: 'Provider B',
      description: 'Second test provider',
      next: async (agentResponse: AgentOutputItem[]) =>
        `next-B-${JSON.stringify(agentResponse)}`,
    },
    providerC: {
      name: 'Provider C',
      description: 'An erroring test provider',
      next: jest.fn().mockRejectedValue(new Error('Something bad happened')),
    },
  };

  const dummyAgentOutput: AgentOutputItem[] = [
    { role: 'assistant', content: 'Hello' },
    { role: 'assistant', content: 'World' },
  ] as unknown as AgentOutputItem[];

  it('should format context with providers and agent response', async () => {
    const result = await formatter.format(
      dummyAgentOutput,
      Object.values(dummyProviders),
    );

    expect(result).toContain('Provider A');
    expect(result).toContain('First test provider');
    expect(result).toContain('Provider B');
    expect(result).toContain('Second test provider');
    expect(result).toContain('Hello');
    expect(result).toContain('World');
    expect(result).toContain(
      JSON.stringify({
        contextProviderName: 'Provider C',
        contextProviderDescription: 'An erroring test provider',
        currentContextValue:
          'Error generating context: Error: Something bad happened',
      }),
    );

    expect(result).toMatch(/next-A-/);
    expect(result).toMatch(/next-B-/);
  });
});
