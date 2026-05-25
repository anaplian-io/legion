import { NodeSplitter } from '../types/node-splitter.js';
import { Node } from '../types/node.js';
import { Provider } from '../types/provider.js';
import { MemoryNodeFactory } from '../types/memory-node-factory.js';
import { EventStream } from '../types/event-stream.js';

export interface MemoryNodeSplitterProps {
  readonly splittingProvider: Provider;
  readonly newNodeProvider: Provider;
  readonly memoryNodeFactory: MemoryNodeFactory;
  readonly eventStream: EventStream;
}

export class MemoryNodeSplitter implements NodeSplitter<'memory'> {
  constructor(private readonly props: MemoryNodeSplitterProps) {}

  readonly split = async (
    node: Node<'memory'>,
  ): Promise<[Node<'memory'>, Node<'memory'>]> => {
    const context = node.context;
    const [leftContext, rightContext] =
      await this.props.splittingProvider.splitString(context);

    const createSplitNode = (initialContext: string) => {
      return this.props.memoryNodeFactory.create({
        initialContext,
        eventStream: this.props.eventStream,
      });
    };

    const leftNode = createSplitNode(leftContext);
    const rightNode = createSplitNode(rightContext);

    return [leftNode, rightNode];
  };
}
