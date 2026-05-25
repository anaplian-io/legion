import { Node } from './node.js';
import { EventStream } from './event-stream.js';

export interface CreateProps {
  readonly initialContext: string;
  readonly eventStream: EventStream;
}

export interface MemoryNodeFactory {
  readonly create: (props: CreateProps) => Node<'memory'>;
}
