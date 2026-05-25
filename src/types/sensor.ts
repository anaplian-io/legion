import { BroadcastMessage } from './node.js';

export interface Sensor {
  readonly sense: (broadcastMessage: BroadcastMessage) => Promise<string>;
}
