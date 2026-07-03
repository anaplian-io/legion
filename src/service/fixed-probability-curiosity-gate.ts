import { RelevanceGate } from '../types/relevance-gate.js';

export interface FixedProbabilityCuriosityGateProps {
  readonly probability: number;
}

export class FixedProbabilityCuriosityGate implements RelevanceGate {
  private readonly probability: number;

  constructor(
    props: FixedProbabilityCuriosityGateProps,
    private readonly randomFn: typeof Math.random = Math.random,
  ) {
    this.probability = props.probability;
  }

  public readonly isRelevant: RelevanceGate['isRelevant'] = async () =>
    this.randomFn() < this.probability;
}
