import { Node } from './node.js';
import { Provider } from './provider.js';

export interface MemoryNodeFactoryProps {
  readonly provider: Provider;
}

export interface MemoryNodeFactory {
  readonly create: (initialContext: string) => Node<'memory'>;
}
