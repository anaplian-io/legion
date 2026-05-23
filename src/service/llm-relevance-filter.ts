import { RelevanceFilter } from '../types/relevance-filter.js';
import { Provider } from '../types/provider.js';
import { AttentionGate } from '../types/attention-gate.js';
import { Message } from '../types/message.js';
import { WorkingMemory } from '../types/working-memory.js';
import { isDefined } from '../utilities/is-defined.js';

export interface LlmRelevanceFilterProps {
  readonly provider: Provider;
  readonly attentionGate: AttentionGate;
}

export class LlmRelevanceFilter implements RelevanceFilter {
  constructor(private readonly props: LlmRelevanceFilterProps) {}

  public readonly filter = async (
    workingMemory: WorkingMemory,
    candidateMessages: Message[],
  ): Promise<Message[]> => {
    const { provider, attentionGate } = this.props;
    if (candidateMessages.length === 0) {
      return [];
    }
    const concatenatedConcept = workingMemory.messages
      .map((message, index) => `[MESSAGE ${index}]:${message.content}\n`)
      .join();
    const attentionGateValue = await attentionGate.getTopN({ workingMemory });
    if (
      attentionGateValue === 'all' ||
      attentionGateValue >= candidateMessages.length
    ) {
      return candidateMessages;
    }
    return (
      await provider.rankByRelevance(
        concatenatedConcept,
        candidateMessages.map((message) => message.content),
      )
    )
      .map((messageIndex) => candidateMessages[messageIndex])
      .filter(isDefined)
      .slice(0, attentionGateValue);
  };
}
