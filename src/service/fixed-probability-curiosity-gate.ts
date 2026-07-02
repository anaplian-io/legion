import { CuriosityGate } from '../types/curiosity-gate.js';

export interface FixedProbabilityCuriosityGateProps {
  readonly probability: number;
}

export class FixedProbabilityCuriosityGate implements CuriosityGate {
  private readonly probability: number;

  constructor(
    props: FixedProbabilityCuriosityGateProps,
    private readonly randomFn: typeof Math.random = Math.random,
  ) {
    this.probability = props.probability;
  }

  public readonly isCurious: CuriosityGate['isCurious'] = async () =>
    this.randomFn() < this.probability;
}
