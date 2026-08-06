import type {
  BuildMemoryContextSuffixProps,
  MemoryContextBuilder,
} from '../../types/memory-context-builder.js';
import type { Message } from '../../types/message.js';
import { contentHash } from '../../telemetry/content-evidence.js';
import { formatMessagePayload } from '../../utilities/action-request.js';

const EVIDENCE_MARKER_PATTERN =
  /^\[AFFERENT EVIDENCE v1 sha256=([a-f\d]{64})\]$/gmu;

/**
 * Keeps accumulated memory append-only while applying deterministic retention
 * and deduplication rules without another model call.
 */
export class AppendOnlyMemoryContextBuilder implements MemoryContextBuilder {
  public readonly buildContextSuffix: MemoryContextBuilder['buildContextSuffix'] =
    ({
      accumulatedContext,
      afferentContext,
      broadcast,
      response,
    }: BuildMemoryContextSuffixProps): string => {
      const retainedHashes = retainedEvidenceHashes(accumulatedContext);
      const parts: string[] = [];
      for (const message of afferentContext) {
        if (!isRetainable(message)) {
          continue;
        }
        const fingerprint = retainedEvidenceFingerprint(message);
        if (retainedHashes.has(fingerprint)) {
          continue;
        }
        retainedHashes.add(fingerprint);
        parts.push(
          `[AFFERENT EVIDENCE v1 sha256=${fingerprint}]`,
          JSON.stringify(retainedMessage(message)),
        );
      }
      parts.push(
        `[BROADCAST MESSAGE]:${formatMessagePayload(broadcast)}`,
        `[NODE RESPONSE]:${formatMessagePayload(response)}`,
      );
      return `\n\n${parts.join('\n')}`;
    };
}

const retainedEvidenceHashes = (context: string): Set<string> =>
  new Set(
    [...context.matchAll(EVIDENCE_MARKER_PATTERN)].map((match) => match[1]!),
  );

const isRetainable = (message: Message): boolean =>
  message.role !== 'afferent-capability' &&
  (message.content.trim().length > 0 ||
    (message.actionRequests?.length ?? 0) > 0 ||
    (message.evidence?.length ?? 0) > 0);

const retainedEvidenceFingerprint = (message: Message): string =>
  contentHash({
    role: message.role,
    content: message.content,
    originatingNodeId: message.originatingNodeId,
    contributingNodeIds: sorted(message.contributingNodeIds),
    actionRequests: message.actionRequests,
    goalDecision: message.goalDecision,
    evidenceContentHashes: sorted(
      message.evidence?.map((evidence) => evidence.contentHash),
    ),
    inputIds: message.inputIds,
  });

const retainedMessage = (message: Message): Omit<Message, 'candidateId'> => ({
  role: message.role,
  content: message.content,
  ...(message.originatingNodeId === undefined
    ? {}
    : { originatingNodeId: message.originatingNodeId }),
  ...(message.contributingNodeIds === undefined
    ? {}
    : { contributingNodeIds: message.contributingNodeIds }),
  ...(message.actionRequests === undefined
    ? {}
    : { actionRequests: message.actionRequests }),
  ...(message.goalDecision === undefined
    ? {}
    : { goalDecision: message.goalDecision }),
  ...(message.evidence === undefined ? {} : { evidence: message.evidence }),
  ...(message.inputIds === undefined ? {} : { inputIds: message.inputIds }),
});

const sorted = (
  values: readonly string[] | undefined,
): readonly string[] | undefined =>
  values === undefined ? undefined : [...values].sort();
