import { GenerateProps, Provider } from '../types/provider.js';
import { OpenAI } from 'openai';

export interface OpenAiProviderProps {
  readonly model: string;
  readonly client: OpenAI;
}

export class OpenaiProvider implements Provider {
  constructor(private readonly props: OpenAiProviderProps) {}

  public readonly generate = async (props: GenerateProps): Promise<string> => {
    const inputItems = [
      {
        role: 'system' as const,
        content: props.systemPrompt,
      },
      ...props.messages.map((m) => ({
        role: 'user' as const,
        content: m.content,
      })),
    ];

    const response = await this.props.client.responses.create({
      model: this.props.model,
      input: inputItems,
    });

    return response.output_text ?? '';
  };

  public readonly rankByRelevance = async (
    concept: string,
    items: string[],
  ): Promise<number[]> => {
    const response = await this.props.client.responses.create({
      model: this.props.model,
      temperature: 0,
      input: `You are a relevance ranking assistant. Given a concept and a list of items, return the items ranked from most to least relevant to the concept.
Respond with ONLY a JSON array of the original indices in order of relevance (most to least).
Example: {"rankedIndices": [2, 0, 1]}

Concept: "${concept}"

Items: ${items.map((item, i) => `${i}: ${item}`).join('\n')}`,
      text: {
        format: {
          type: 'json_schema',
          name: 'ranking',
          schema: {
            type: 'object',
            properties: {
              rankedIndices: {
                type: 'array',
                items: { type: 'number' },
                description:
                  'Original item indices ordered from most to least relevant',
              },
            },
            required: ['rankedIndices'],
            additionalProperties: false,
          },
        },
      },
    });

    const { rankedIndices } = JSON.parse(response.output_text) as {
      rankedIndices: number[];
    };

    return rankedIndices;
  };

  public readonly askYesNoQuestion = async (
    question: string,
  ): Promise<boolean> => {
    const response = await this.props.client.responses.create({
      model: this.props.model,
      temperature: 0,
      input: `
${question}

Answer the above yes/no question.
Respond with ONLY a JSON object.
Example: {"answer": true}`,
      text: {
        format: {
          type: 'json_schema',
          name: 'yes_no_answer',
          schema: {
            type: 'object',
            properties: {
              answer: {
                type: 'boolean',
                description: 'true for yes, false for no',
              },
            },
            required: ['answer'],
            additionalProperties: false,
          },
        },
      },
    });

    const { answer } = JSON.parse(response.output_text) as { answer: boolean };
    return answer;
  };

  public readonly splitString = async (
    content: string,
  ): Promise<[string, string]> => {
    const response = await this.props.client.responses.create({
      model: this.props.model,
      temperature: 0,
      input: `Split the following content into two coherent parts based on semantic grouping of concepts.
Respond with ONLY a JSON object.
Example Output: {"left": "This is some content about rainbows.", "right": "This is some content about birds."}

Content to split:
${content}`,
      text: {
        format: {
          type: 'json_schema',
          name: 'split_output',
          schema: {
            type: 'object',
            properties: {
              left: { type: 'string' },
              right: { type: 'string' },
            },
            required: ['left', 'right'],
            additionalProperties: false,
          },
        },
      },
    });

    const { left, right } = JSON.parse(response.output_text) as {
      left: string;
      right: string;
    };

    return [left, right];
  };
}
