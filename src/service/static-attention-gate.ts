import { AttentionGate } from '../types/attention-gate.js';

export interface StaticAttentionGateProps {
  readonly n: number;
}

export class StaticAttentionGate implements AttentionGate {
  constructor(private readonly props: StaticAttentionGateProps) {}
  readonly getTopN = async (): Promise<number | 'all'> => {
    return this.props.n;
  };
}
