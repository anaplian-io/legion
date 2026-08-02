import { Message } from '../../types/message.js';
import { Provider } from '../../types/provider.js';
import { RelevanceGate } from '../../types/relevance-gate.js';

export interface AskYesNoQuestionRelevanceGateProps {
  readonly provider: Provider;
  readonly question: string;
}

export class AskYesNoQuestionRelevanceGate implements RelevanceGate {
  constructor(private readonly props: AskYesNoQuestionRelevanceGateProps) {}

  public readonly isRelevant: RelevanceGate['isRelevant'] = async ({
    broadcastMessage,
    nodeContext,
  }) => {
    const messages: Message[] = [
      ...broadcastMessage.workingMemory.messages,
      ...(broadcastMessage.afferentContext ?? []),
      broadcastMessage.broadcast,
    ];
    const questionProps = {
      systemPrompt: nodeContext ?? '',
      messages,
      question: this.props.question,
    };
    return this.props.provider.askYesNoQuestion(questionProps, {
      stage: 'node-relevance',
      ...broadcastMessage.telemetry,
    });
  };
}
