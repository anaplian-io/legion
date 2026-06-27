import {
  AskYesNoQuestionProps,
  GenerateProps,
  GenerateWithToolsProps,
  MinimalOpenAi,
  Provider,
  ToolCall,
  ToolDefinition,
} from '../types/provider.js';
import { OpenAI } from 'openai';

export interface OpenAiProviderProps {
  readonly model: string;
  readonly client: MinimalOpenAi;
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
      input: inputItems satisfies OpenAI.Responses.ResponseInputItem[],
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
      input: [
        {
          role: 'system' as const,
          content: `You rank items by how much each one advances the given concept. Return every input index exactly once, ordered most to least relevant.
Respond with ONLY a JSON object matching the schema.
Example: {"rankedIndices": [2, 0, 1]}`,
        },
        {
          role: 'user' as const,
          content: `Concept:
${concept}

Items:
${items.map((item, i) => `${i}: ${item}`).join('\n')}`,
        },
      ] satisfies OpenAI.Responses.ResponseInputItem[],
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
    props: AskYesNoQuestionProps,
  ): Promise<boolean> => {
    const response = await this.props.client.responses.create({
      model: this.props.model,
      temperature: 0,
      input: [
        {
          role: 'system' as const,
          content: props.systemPrompt,
        },
        ...props.messages.map((m) => ({
          role: 'user' as const,
          content: m.content,
        })),
        {
          role: 'user' as const,
          content: `${props.question}

Answer the above yes/no question.
Respond with ONLY a JSON object matching the schema.
Example: {"answer": true}`,
        },
      ] satisfies OpenAI.Responses.ResponseInputItem[],
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

    const { answer } = JSON.parse(
      response.output_text.replaceAll('```json', '').replaceAll('```', ''),
    ) as { answer: boolean };
    return answer;
  };

  public readonly splitString = async (
    content: string,
  ): Promise<[string, string]> => {
    const response = await this.props.client.responses.create({
      model: this.props.model,
      temperature: 0,
      input: [
        {
          role: 'system' as const,
          content: `A node's accumulated experience has grown too large and must split into two specialists. Divide the content by topic so each part is internally coherent and the two overlap as little as possible. Preserve the original wording; do not summarize or invent.
Respond with ONLY a JSON object matching the schema.
Example: {"left": "This is some content about rainbows.", "right": "This is some content about birds."}`,
        },
        {
          role: 'user' as const,
          content,
        },
      ] satisfies OpenAI.Responses.ResponseInputItem[],
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

    const { left, right } = JSON.parse(
      response.output_text.replaceAll('```json', '').replaceAll('```', ''),
    ) as {
      left: string;
      right: string;
    };

    return [left, right];
  };

  private mapToolToOpenAITool(tool: ToolDefinition): OpenAI.Responses.Tool {
    return {
      type: 'function' as const,
      name: tool.name,
      description: tool.description ?? null,
      parameters: tool.parameters,
      strict: true,
    };
  }

  public readonly generateWithTools = async (
    props: GenerateWithToolsProps,
  ): Promise<{ content: string; toolCalls: ToolCall[] | undefined }> => {
    const inputItems: OpenAI.Responses.ResponseInputItem[] = [
      {
        role: 'system' as const,
        content: props.systemPrompt,
      } satisfies OpenAI.Responses.EasyInputMessage,
      ...props.messages.map(
        (m) =>
          ({
            role: 'user',
            content: m.content,
          }) satisfies OpenAI.Responses.EasyInputMessage,
      ),
    ];

    const mappedTools: OpenAI.Responses.Tool[] = [];
    for (const tool of props.tools) {
      mappedTools.push(this.mapToolToOpenAITool(tool));
    }

    const params: {
      model: string;
      input: OpenAI.Responses.ResponseInputItem[];
      tools: OpenAI.Responses.Tool[];
    } = {
      model: this.props.model,
      input: inputItems,
      tools: mappedTools,
    };
    const response = await this.props.client.responses.create({
      ...params,
      tool_choice: 'required',
    });
    const content = response.output_text ?? '';
    const toolCalls: ToolCall[] = [];
    if (response.output && Array.isArray(response.output)) {
      for (const item of response.output) {
        if (
          item &&
          typeof item === 'object' &&
          'type' in item &&
          item.type === 'function_call'
        ) {
          const call = item as OpenAI.Responses.ResponseFunctionToolCall;
          toolCalls.push({
            id: call.call_id,
            type: 'function' as const,
            function: {
              // `call.arguments` is already a JSON string per the Responses
              // API. Re-stringifying double-encodes it, so the downstream
              // JSON.parse in MCPClient.invokeTool yields a string instead of
              // the arguments object and the tool call is malformed.
              name: call.name,
              arguments: call.arguments,
            },
          });
        }
      }
    }
    if (toolCalls.length > 0) {
      return { content, toolCalls };
    }
    return { content, toolCalls: undefined };
  };
}
