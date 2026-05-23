import { NodeSplitter } from '../types/node-splitter.js';
import { Node } from '../types/node.js';
import { MemoryNode } from '../node/memory-node.js';
import { Provider } from '../types/provider.js';

export interface MemoryNodeSplitterProps {
  /**
   * The provider used to analyze and split the context intelligently.
   */
  readonly splittingProvider: Provider;

  /**
   * The provider that will be passed to the newly created nodes.
   */
  readonly newNodeProvider: Provider;
}

export class MemoryNodeSplitter implements NodeSplitter<'memory'> {
  constructor(private readonly props: MemoryNodeSplitterProps) {}

  readonly split = async (
    node: Node<'memory'>,
  ): Promise<[Node<'memory'>, Node<'memory'>]> => {
    const context = node.context;

    // Use the splitting provider to intelligently split the context
    const [leftContext, rightContext] =
      await this.props.splittingProvider.splitString(context);

    // Create two new memory nodes with the split contexts using the newNodeProvider
    const leftNode = this.createMemoryNode(node.id, 'left', leftContext);
    const rightNode = this.createMemoryNode(node.id, 'right', rightContext);

    return [leftNode, rightNode];
  };

  private createMemoryNode(
    parentId: string,
    side: 'left' | 'right',
    initialContext: string,
  ): Node<'memory'> {
    return new MemoryNode({
      id: `${parentId}-${side}`,
      initialContext,
      provider: this.props.newNodeProvider,
    });
  }
}
