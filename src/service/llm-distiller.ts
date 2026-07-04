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

    const systemPrompt = `You consolidate a reasoning step into one line of working memory. Capture only what the next step needs: new facts, decisions, and open questions. Drop restated context. Be terse and concrete.`;

    const userContent = `Working memory:
${workingMemory.messages.map((message, index) => `${index}: ${message.content}`).join('\n')}

This step's surviving broadcasts:
${broadcasts.map((broadcast, index) => `[BROADCAST ${index}]: ${broadcast}`).join('\n')}`;

    return this.props.provider.generate({
      systemPrompt,
      messages: [{ role: 'working-memory', content: userContent }],
    });
  };
}
