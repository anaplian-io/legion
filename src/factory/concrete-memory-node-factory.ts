import { MemoryNode } from '../node/memory-node.js';
import { Node } from '../types/node.js';
import { Provider } from '../types/provider.js';
import {
  CreateProps,
  MemoryNodeFactory,
} from '../types/memory-node-factory.js';
import { RelevanceGate } from '../types/relevance-gate.js';
import type { MemoryContextBuilder } from '../types/memory-context-builder.js';
import type { MemoryPromptBuilder } from '../types/memory-prompt-builder.js';

export interface ConcreteMemoryNodeFactoryProps {
  readonly provider: Provider;
  readonly relevanceGate: RelevanceGate;
  readonly contextBuilder: MemoryContextBuilder;
  readonly promptBuilder: MemoryPromptBuilder;
}

export class ConcreteMemoryNodeFactory implements MemoryNodeFactory {
  private readonly _provider: Provider;
  private readonly _relevanceGate: RelevanceGate;
  private readonly _contextBuilder: MemoryContextBuilder;
  private readonly _promptBuilder: MemoryPromptBuilder;

  constructor(props: ConcreteMemoryNodeFactoryProps) {
    this._provider = props.provider;
    this._relevanceGate = props.relevanceGate;
    this._contextBuilder = props.contextBuilder;
    this._promptBuilder = props.promptBuilder;
  }

  public readonly create = (props: CreateProps): Node<'memory'> => {
    const id = props.nodeId ?? crypto.randomUUID();
    return new MemoryNode({
      id,
      initialContext: props.initialContext,
      provider: this._provider,
      eventStream: props.eventStream,
      relevanceGate: this._relevanceGate,
      contextBuilder: this._contextBuilder,
      promptBuilder: this._promptBuilder,
    });
  };
}
