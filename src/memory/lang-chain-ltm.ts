import {
  LongTermMemoryStore,
  MemoryItem,
} from '../types/long-term-memory-store.js';
import { VectorStore } from '@langchain/core/vectorstores';
import { TextSplitter } from '@langchain/textsplitters';

export interface LangChainLtmProps {
  readonly vectorStore: VectorStore;
  readonly textSplitter: TextSplitter;
  readonly maxResults: number;
}

export class LangChainLtm implements LongTermMemoryStore {
  constructor(private readonly props: LangChainLtmProps) {}

  public readonly addDocuments = (documents: string[]): Promise<this> => {
    const date = new Date();
    return this.addMemoryItems(
      documents.map((document) => ({
        page: document,
        date,
      })),
    );
  };

  public readonly addMemoryItems = async (
    memoryItems: MemoryItem[],
  ): Promise<this> => {
    const { textSplitter, vectorStore } = this.props;
    const subDocuments = await textSplitter.splitDocuments(
      memoryItems.map((item) => ({
        pageContent: item.page,
        metadata: {
          date: item.date.getTime(),
        },
      })),
    );
    await vectorStore.addDocuments(subDocuments);
    return this;
  };

  public readonly search = async (query: string): Promise<MemoryItem[]> => {
    const { vectorStore, maxResults } = this.props;
    const response = await vectorStore.similaritySearch(query);
    return response
      .map((memory) => ({
        page: memory.pageContent,
        date: new Date(memory.metadata['date']),
      }))
      .toSorted((first, second) => second.date.getTime() - first.date.getTime())
      .slice(0, maxResults);
  };
}
