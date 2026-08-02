import {
  DistillationProps,
  DistillationResult,
  Distiller,
} from '../types/distiller.js';
import { DistillationValidator } from './distillation-validator.js';

export interface ValidatedDistillerProps {
  readonly primary: Distiller;
  readonly fallback: Distiller;
  readonly validator: DistillationValidator;
}

/** Validates a primary strategy and uses a structure-preserving fallback. */
export class ValidatedDistiller implements Distiller {
  constructor(private readonly props: ValidatedDistillerProps) {}

  public readonly distill = async (
    input: DistillationProps,
  ): Promise<DistillationResult | undefined> => {
    try {
      const primaryResult = await this.props.primary.distill(input);
      if (primaryResult === undefined) {
        return undefined;
      }
      this.props.validator.validate(input, primaryResult);
      return primaryResult;
    } catch {
      const fallbackResult = await this.props.fallback.distill(input);
      if (fallbackResult === undefined) {
        return undefined;
      }
      this.props.validator.validate(input, fallbackResult);
      return fallbackResult;
    }
  };
}
