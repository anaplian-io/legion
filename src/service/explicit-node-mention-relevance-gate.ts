import { RelevanceGate } from '../types/relevance-gate.js';

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class ExplicitNodeMentionRelevanceGate implements RelevanceGate {
  public readonly isRelevant: RelevanceGate['isRelevant'] = async ({
    broadcastMessage,
    nodeId,
  }) => {
    if (nodeId.length === 0) {
      return false;
    }

    const escapedNodeId = escapeRegExp(nodeId);
    const mentionPattern = new RegExp(
      `(^|[^A-Za-z0-9_-])@?${escapedNodeId}($|[^A-Za-z0-9_-])`,
    );
    return mentionPattern.test(broadcastMessage.broadcast.content);
  };
}
