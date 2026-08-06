import type { MemoryPromptBuilder } from '../../types/memory-prompt-builder.js';
import type { Message } from '../../types/message.js';
import { contentHash } from '../../telemetry/content-evidence.js';
import { formatMessagePayload } from '../../utilities/action-request.js';

/** Preserves the cache-stable cognitive order while removing exact repeats. */
export class DeduplicatingMemoryPromptBuilder implements MemoryPromptBuilder {
  public readonly buildMessages: MemoryPromptBuilder['buildMessages'] = (
    broadcastMessage,
  ) => {
    const messages = [...broadcastMessage.workingMemory.messages];
    const seenPayloads = new Set(messages.map(promptPayloadKey));
    const seenCapabilities = new Set<string>();
    for (const afferent of broadcastMessage.afferentContext ?? []) {
      if (afferent.role === 'afferent-capability') {
        const key = promptPayloadKey(afferent);
        if (!seenCapabilities.has(key)) {
          seenCapabilities.add(key);
          messages.push(afferent);
        }
        continue;
      }
      const key = promptPayloadKey(afferent);
      if (!seenPayloads.has(key)) {
        seenPayloads.add(key);
        messages.push(afferent);
      }
    }
    messages.push(broadcastMessage.broadcast);
    return messages;
  };
}

const promptPayloadKey = (message: Message): string =>
  contentHash({
    payload: formatMessagePayload(message),
    userInputIds:
      message.role === 'user-input' ? (message.inputIds ?? []) : undefined,
  });
