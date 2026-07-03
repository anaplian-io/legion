import { RelevanceGate } from '../types/relevance-gate.js';

export interface SequencedCompositeRelevanceGateProps {
  readonly gates: readonly RelevanceGate[];
}

export class SequencedCompositeRelevanceGate implements RelevanceGate {
  constructor(private readonly props: SequencedCompositeRelevanceGateProps) {}

  public readonly isRelevant: RelevanceGate['isRelevant'] = async (props) => {
    for (const gate of this.props.gates) {
      if (await gate.isRelevant(props)) {
        return true;
      }
    }
    return false;
  };
}
