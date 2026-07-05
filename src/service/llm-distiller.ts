import { Provider } from '../types/provider.js';
import { DistillationProps, Distiller } from '../types/distiller.js';
import { MessageRole } from '../types/message.js';

export interface LlmDistillerProps {
  readonly provider: Provider;
}

export class LlmDistiller implements Distiller {
  constructor(private readonly props: LlmDistillerProps) {}

  public readonly distill = async (
    props: DistillationProps,
  ): Promise<string> => {
    const { workingMemory, broadcasts, afferentContext = [] } = props;

    const systemPrompt = `You consolidate a reasoning step into the next global workspace broadcast. Capture only what the next step needs: new facts, decisions, open questions, and concrete next actions. Be terse and concrete.

If afferent context contains user input, acknowledge and address it directly when possible before preserving or resuming the prior line of inquiry. Do not ignore the user.

Preserve exact afferent node IDs and concrete unresolved requests when a surviving broadcast asks a tool or sensor to act.`;

    const userContent = `Working memory:
${workingMemory.messages.map((message, index) => `${index}: ${message.content}`).join('\n')}

This step's afferent context:
${afferentContext.map((message, index) => formatMessage(message, index)).join('\n')}

This step's surviving broadcasts:
${broadcasts.map((broadcast, index) => `[BROADCAST ${index}]: ${broadcast}`).join('\n')}`;

    return this.props.provider.generate({
      systemPrompt,
      messages: [{ role: 'working-memory', content: userContent }],
    });
  };
}

const formatMessage = (
  message: {
    readonly role: MessageRole;
    readonly content: string;
    readonly originatingNodeId?: string;
  },
  index: number,
): string => {
  const origin =
    message.originatingNodeId === undefined
      ? ''
      : ` from ${message.originatingNodeId}`;
  return `[${MESSAGE_ROLE_LABEL[message.role]} ${index}${origin}]: ${message.content}`;
};

const MESSAGE_ROLE_LABEL: Record<MessageRole, string> = {
  'working-memory': 'WORKING MEMORY',
  broadcast: 'BROADCAST',
  'user-input': 'USER INPUT',
  afferent: 'AFFERENT',
  'afferent-capability': 'AFFERENT CAPABILITY',
  'node-response': 'NODE RESPONSE',
};
