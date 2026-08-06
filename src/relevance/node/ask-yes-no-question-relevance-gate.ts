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
    messages,
    nodeContext,
  }) => {
    const questionProps = {
      systemPrompt: nodeContext ?? '',
      messages: [...messages],
      question: this.props.question,
    };
    return this.props.provider.askYesNoQuestion(questionProps, {
      stage: 'node-relevance',
      ...broadcastMessage.telemetry,
    });
  };
}
