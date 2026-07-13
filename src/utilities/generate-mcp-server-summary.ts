import { McpServerSummarySupplier } from '../types/legion-settings.js';

const SUMMARY_SYSTEM_PROMPT =
  'Write one concise capability description for this MCP server. Start with "can" and mention only actions or information the supplied tools support. Return only the description.';

export const generateSummary =
  (): McpServerSummarySupplier =>
  async ({ provider, tools }) =>
    provider.generate({
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user-input',
          content: `MCP tools:\n${JSON.stringify(tools)}`,
        },
      ],
    });
