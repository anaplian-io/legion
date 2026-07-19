import { RelevanceGate } from '../types/relevance-gate.js';

export interface FirstEpochThenFixedCuriosityGateProps {
  readonly probability?: number;
}

/** Guarantees one first-epoch activation, then uses a fixed probability. */
export class FirstEpochThenFixedCuriosityGate implements RelevanceGate {
  private readonly probability: number;

  constructor(
    private readonly randomFn: typeof Math.random = Math.random,
    props: FirstEpochThenFixedCuriosityGateProps = {},
  ) {
    this.probability = props.probability ?? 0.03;
    if (this.probability < 0 || this.probability > 1) {
      throw new Error(
        '[FirstEpochThenFixedCuriosityGate] probability must be between 0 and 1',
      );
    }
  }

  public readonly isRelevant: RelevanceGate['isRelevant'] = async (props) => {
    if (props.epochsAlive === 0) {
      return true;
    }
    return this.randomFn() < this.probability;
  };
}
