import { MemoryNode } from '../node/memory-node.js';
import { Node } from '../types/node.js';
import { Provider } from '../types/provider.js';
import {
  CreateProps,
  MemoryNodeFactory,
} from '../types/memory-node-factory.js';
import { CuriosityGate } from '../types/curiosity-gate.js';

export interface ConcreteMemoryNodeFactoryProps {
  readonly provider: Provider;
  readonly curiosityGate: CuriosityGate;
}

export class ConcreteMemoryNodeFactory implements MemoryNodeFactory {
  private readonly _provider: Provider;
  private readonly _curiosityGate: CuriosityGate;

  constructor(props: ConcreteMemoryNodeFactoryProps) {
    this._provider = props.provider;
    this._curiosityGate = props.curiosityGate;
  }

  public readonly create = (props: CreateProps): Node<'memory'> => {
    const id = props.nodeId ?? crypto.randomUUID();
    return new MemoryNode({
      id,
      initialContext: props.initialContext,
      provider: this._provider,
      eventStream: props.eventStream,
      curiosityGate: this._curiosityGate,
    });
  };
}
