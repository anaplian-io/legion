import { Node } from './node.js';

export interface NodeSplitter<T extends string> {
  readonly split: (node: Node<T>) => Promise<[Node<T>, Node<T>]>;
}
