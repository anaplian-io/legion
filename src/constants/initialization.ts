import { OpenAIProvider, setDefaultModelProvider } from '@openai/agents';

export const init = () => {
  setDefaultModelProvider(
    new OpenAIProvider({
      apiKey: 'NA',
      baseURL: 'http://127.0.0.1:1234/v1',
      useResponses: true,
    }),
  );
};
