import { Message } from './message.js';

export interface GenerateProps {
  readonly systemPrompt: string;
  readonly messages: Message[];
}

export interface Provider {
  readonly generate: (props: GenerateProps) => Promise<string>;
  readonly rankByRelevance: (
    concept: string,
    items: string[],
  ) => Promise<number[]>;
  readonly askYesNoQuestion: (question: string) => Promise<boolean>;
  readonly splitString: (content: string) => Promise<[string, string]>;
}
