import { CuriosityGate, CuriosityGateProps } from '../types/curiosity-gate.js';
import { hash } from 'node:crypto';

export class GeometricScheduleCuriosityGate implements CuriosityGate {
  public lastEpochHash: string | undefined = undefined;
  private curiosity: number = 0.5;

  constructor(private readonly randomFn: typeof Math.random = Math.random) {}

  public readonly isCurious = async (
    props: CuriosityGateProps,
  ): Promise<boolean> => {
    const epochHash = hash('sha1', JSON.stringify(props.broadcastMessage));
    if (this.lastEpochHash !== epochHash) {
      if (this.lastEpochHash !== undefined) {
        this.curiosity *= 0.5;
      }
      this.lastEpochHash = epochHash;
    }
    return this.randomFn() < this.curiosity;
  };
}
