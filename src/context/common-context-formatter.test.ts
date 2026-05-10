import { CommonContextFormatter } from './common-context-formatter.js';
import { ContextProvider } from '../types/context.js';

describe('CommonContextFormatter', () => {
  const formatter = CommonContextFormatter;

  const dummyProviders: Record<string, ContextProvider> = {
    providerA: {
      name: 'Provider A',
      description: 'First test provider',
      next: async () => `next-A`,
    },
    providerB: {
      name: 'Provider B',
      description: 'Second test provider',
      next: async () => `next-B`,
    },
    providerC: {
      name: 'Provider C',
      description: 'An erroring test provider',
      next: async () => {
        throw new Error('Something bad happened');
      },
    },
  };

  it('should format context with providers and handle errors', async () => {
    const result = await formatter.format([], Object.values(dummyProviders));

    expect(result).toContain('Provider A');
    expect(result).toContain('First test provider');
    expect(result).toContain('Provider B');
    expect(result).toContain('Second test provider');
    expect(result).toContain(
      JSON.stringify({
        contextProviderName: 'Provider C',
        contextProviderDescription: 'An erroring test provider',
        currentContextValue:
          'Error generating context: Error: Something bad happened',
      }),
    );

    expect(result).toMatch(/next-A/);
    expect(result).toMatch(/next-B/);
  });
});
