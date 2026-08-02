import { Node } from './node.js';
import type { EpochTelemetryContext } from './telemetry.js';

export interface NodeSplitter<T extends string> {
  readonly split: (
    node: Node<T>,
    telemetry: EpochTelemetryContext,
  ) => Promise<[Node<T>, Node<T>]>;
}
