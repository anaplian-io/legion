import { RelevanceGate } from '../types/relevance-gate.js';

/** Activates a node only when a structured action request targets its exact ID. */
export class TargetedActionRequestRelevanceGate implements RelevanceGate {
  public readonly isRelevant: RelevanceGate['isRelevant'] = async ({
    broadcastMessage,
    nodeId,
  }) => {
    if (nodeId.length === 0) {
      return false;
    }

    return (
      broadcastMessage.broadcast.actionRequests?.some(
        (request) => request.targetNodeId === nodeId,
      ) ?? false
    );
  };
}
