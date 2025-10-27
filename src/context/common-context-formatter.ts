import { ContextFormatter } from '../types/context.js';

export const CommonContextFormatter: ContextFormatter = {
  format: (agentResponse, providers): Promise<string> =>
    Promise.all(
      providers.map(async (provider) => ({
        provider,
        context: await provider
          .next(agentResponse)
          .catch((reason) => `Error generating context: ${reason}`),
      })),
    ).then((allResolvedContexts) =>
      allResolvedContexts
        .map(({ provider, context }) =>
          JSON.stringify({
            contextProviderName: provider.name,
            contextProviderDescription: provider.description,
            currentContextValue: context,
          }),
        )
        .join('\n'),
    ),
};
