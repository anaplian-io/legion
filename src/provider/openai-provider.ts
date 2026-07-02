import {
  AskYesNoQuestionProps,
  GenerateProps,
  GenerateWithToolsProps,
  MinimalOpenAi,
  Provider,
  ToolCall,
  ToolDefinition,
} from '../types/provider.js';
import {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { isStrictEligible } from '../utilities/is-strict-eligible.js';

export interface OpenAiProviderProps {
  readonly model: string;
  readonly client: MinimalOpenAi;
}

export class OpenaiProvider implements Provider {
  constructor(private readonly props: OpenAiProviderProps) {}

  /** Text of the first choice, or '' when absent/null. */
  private readonly firstContent = (response: ChatCompletion): string => {
    const choice = response.choices[0];
    return choice ? (choice.message.content ?? '') : '';
  };

  /**
   * System prompt + the caller's messages as user turns. Chat-templated models
   * reject prompts with no user turn, so when the caller puts the whole task in
   * the system prompt and passes no messages (e.g. the distiller), a minimal
   * user turn is synthesized.
   */
  private readonly buildMessages = (
    systemPrompt: string,
    messages: readonly { content: string }[],
  ): ChatCompletionMessageParam[] => {
    const items: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m): ChatCompletionMessageParam => ({
        role: 'user',
        content: m.content,
      })),
    ];
    if (messages.length === 0) {
      items.push({
        role: 'user',
        content: 'Produce the output now, following the instructions above.',
      });
    }
    return items;
  };

  public readonly generate = async (props: GenerateProps): Promise<string> => {
    const response = await this.props.client.chat.completions.create({
      model: this.props.model,
      messages: this.buildMessages(props.systemPrompt, props.messages),
    });
    return this.firstContent(response);
  };

  public readonly rankByRelevance = async (
    concept: string,
    items: string[],
  ): Promise<number[]> => {
    const response = await this.props.client.chat.completions.create({
      model: this.props.model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You rank items by how much each one advances the given concept. Return every input index exactly once, ordered most to least relevant.
Respond with ONLY a JSON object matching the schema.
Example: {"rankedIndices": [2, 0, 1]}`,
        },
        {
          role: 'user',
          content: `Concept:
${concept}

Items:
${items.map((item, i) => `${i}: ${item}`).join('\n')}`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ranking',
          strict: true,
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

    return parseJsonOutput<{ rankedIndices: number[] }>(
      this.firstContent(response),
      'rankByRelevance',
    ).rankedIndices;
  };

  public readonly askYesNoQuestion = async (
    props: AskYesNoQuestionProps,
  ): Promise<boolean> => {
    const response = await this.props.client.chat.completions.create({
      model: this.props.model,
      temperature: 0,
      messages: [
        { role: 'system', content: props.systemPrompt },
        ...props.messages.map((m): ChatCompletionMessageParam => ({
          role: 'user',
          content: m.content,
        })),
        {
          role: 'user',
          content: `${props.question}

Answer the above yes/no question.
Respond with ONLY a JSON object matching the schema.
Example: {"answer": true}`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'yes_no_answer',
          strict: true,
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

    return parseJsonOutput<{ answer: boolean }>(
      this.firstContent(response),
      'askYesNoQuestion',
    ).answer;
  };

  public readonly splitString = async (
    content: string,
  ): Promise<[string, string]> => {
    const response = await this.props.client.chat.completions.create({
      model: this.props.model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `A node's accumulated experience has grown too large and must split into two specialists. Divide the content by topic so each part is internally coherent and the two overlap as little as possible. Preserve the original wording; do not summarize or invent.
Respond with ONLY a JSON object matching the schema.
Example: {"left": "This is some content about rainbows.", "right": "This is some content about birds."}`,
        },
        {
          role: 'user',
          content,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'split_output',
          strict: true,
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

    const { left, right } = parseJsonOutput<{ left: string; right: string }>(
      this.firstContent(response),
      'splitString',
    );

    return [left, right];
  };

  private mapToolToOpenAITool(tool: ToolDefinition): ChatCompletionTool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        ...(tool.description !== undefined
          ? { description: tool.description }
          : {}),
        parameters: tool.parameters,
        // Strict mode is only safe when the schema satisfies OpenAI's
        // requirements (additionalProperties:false and all properties required,
        // recursively). Enabling it on an arbitrary MCP schema gets the tool
        // rejected, so we opt in only when the schema is provably compliant.
        strict: isStrictEligible(tool.parameters),
      },
    };
  }

  public readonly generateWithTools = async (
    props: GenerateWithToolsProps,
  ): Promise<{ content: string; toolCalls: ToolCall[] | undefined }> => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: props.systemPrompt },
      ...props.messages.map((m): ChatCompletionMessageParam => ({
        role: 'user',
        content: m.content,
      })),
    ];

    const tools = props.tools.map((tool) => this.mapToolToOpenAITool(tool));

    const response = await this.props.client.chat.completions.create({
      model: this.props.model,
      messages,
      tools,
      tool_choice: 'required',
    });

    const message = response.choices[0]?.message;
    const content = message?.content ?? '';
    const toolCalls: ToolCall[] = [];
    for (const call of message?.tool_calls ?? []) {
      if (call.type === 'function') {
        toolCalls.push({
          id: call.id,
          type: 'function',
          // `call.function.arguments` is already a JSON string; pass it through
          // unchanged so MCPClient.invokeTool parses the arguments object
          // rather than a double-encoded string.
          function: {
            name: call.function.name,
            arguments: call.function.arguments,
          },
        });
      }
    }

    if (toolCalls.length > 0) {
      return { content, toolCalls };
    }
    return { content, toolCalls: undefined };
  };
}

/**
 * Parses a structured-output response body, tolerating a missing/empty body
 * (which a local model can return on a refusal or tool-only response) and
 * markdown code fences, and surfacing failures with the calling method's name
 * rather than an opaque JSON error.
 */
const parseJsonOutput = <T>(content: string, method: string): T => {
  const cleaned = content
    .replaceAll('```json', '')
    .replaceAll('```', '')
    .trim();
  if (cleaned.length === 0) {
    throw new Error(
      `[OpenaiProvider.${method}] model returned no structured output`,
    );
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    throw new Error(
      `[OpenaiProvider.${method}] failed to parse structured output "${cleaned}": ${e}`,
    );
  }
};
