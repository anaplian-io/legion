import { Provider } from '../types/provider.js';
import { DistillationProps, Distiller } from '../types/distiller.js';

export interface LlmDistillerProps {
  readonly provider: Provider;
}

export class LlmDistiller implements Distiller {
  constructor(private readonly props: LlmDistillerProps) {}

  public readonly distill = async (
    props: DistillationProps,
  ): Promise<string> => {
    const { workingMemory, broadcasts } = props;

    const systemPrompt = `You are a working memory distiller. Convert the following successful
broadcasts into a concise new working memory entry.

Working Memory:
${workingMemory.messages.map((message, index) => `${index}: ${message.content}`).join('\n')}

Broadcasts from this epoch:
${broadcasts.map((broadcast, index) => `[BROADCAST ${index}]: ${broadcast}`).join('\n')}

Output: One concise message that captures key insights for next epoch.`;

    return this.props.provider.generate({ systemPrompt, messages: [] });
  };
}
