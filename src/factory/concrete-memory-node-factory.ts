import { MemoryNode } from '../node/memory-node.js';
import { Node } from '../types/node.js';
import { Provider } from '../types/provider.js';
import {
  CreateProps,
  MemoryNodeFactory,
} from '../types/memory-node-factory.js';
import { RelevanceGate } from '../types/relevance-gate.js';

export interface ConcreteMemoryNodeFactoryProps {
  readonly provider: Provider;
  readonly relevanceGate: RelevanceGate;
}

export class ConcreteMemoryNodeFactory implements MemoryNodeFactory {
  private readonly _provider: Provider;
  private readonly _relevanceGate: RelevanceGate;

  constructor(props: ConcreteMemoryNodeFactoryProps) {
    this._provider = props.provider;
    this._relevanceGate = props.relevanceGate;
  }

  public readonly create = (props: CreateProps): Node<'memory'> => {
    const id = props.nodeId ?? crypto.randomUUID();
    return new MemoryNode({
      id,
      initialContext: props.initialContext,
      provider: this._provider,
      eventStream: props.eventStream,
      relevanceGate: this._relevanceGate,
    });
  };
}
