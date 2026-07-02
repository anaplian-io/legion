import { CuriosityGate, CuriosityGateProps } from '../types/curiosity-gate.js';

export interface GeometricScheduleCuriosityGateProps {
  readonly initialCuriosity?: number;
  readonly decayFactor?: number;
}

export class GeometricScheduleCuriosityGate implements CuriosityGate {
  private readonly initialCuriosity: number;
  private readonly decayFactor: number;

  constructor(
    private readonly randomFn: typeof Math.random = Math.random,
    props: GeometricScheduleCuriosityGateProps = {},
  ) {
    this.initialCuriosity = props.initialCuriosity ?? 1.0;
    this.decayFactor = props.decayFactor ?? 0.75;
  }

  public readonly isCurious = async (
    props: CuriosityGateProps,
  ): Promise<boolean> => {
    const curiosity =
      this.initialCuriosity * this.decayFactor ** props.epochsAlive;
    return this.randomFn() < curiosity;
  };
}
