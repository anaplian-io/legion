import { Node } from './node.js';
import { EventStream } from './event-stream.js';

export interface CreateToolNodeProps {
  readonly eventStream: EventStream;
  readonly nodeId?: string;
}

export interface ToolNodeFactory {
  readonly create: (props: CreateToolNodeProps) => Node<'tool'>;
}
