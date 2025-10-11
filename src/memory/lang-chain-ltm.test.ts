import type { VectorStore } from '@langchain/core/vectorstores';
import type { TextSplitter } from '@langchain/textsplitters';
import { LangChainLtm } from './lang-chain-ltm.js';
import { MemoryItem } from '../types/long-term-memory-store.js';

describe('LangChainLtm', () => {
  it('adds a document', async () => {
    const mockVectorStore = {
      addDocuments: jest.fn(),
      similaritySearch: jest.fn(),
    } as unknown as VectorStore;
    const mockTextSplitter = {
      splitDocuments: jest.fn().mockResolvedValue([
        {
          pageContent: 'mock-page-content',
          metadata: {
            date: 1234,
          },
        },
      ]),
    } as unknown as TextSplitter;
    const ltm = new LangChainLtm({
      vectorStore: mockVectorStore,
      textSplitter: mockTextSplitter,
      maxResults: 10,
    });
    await ltm.addDocuments(['mock-page-content']);
    expect(mockTextSplitter.splitDocuments).toHaveBeenCalledTimes(1);
    expect(mockVectorStore.similaritySearch).not.toHaveBeenCalled();
    expect(mockVectorStore.addDocuments).toHaveBeenCalledTimes(1);
    expect(mockVectorStore.addDocuments).toHaveBeenCalledWith([
      {
        pageContent: 'mock-page-content',
        metadata: {
          date: 1234,
        },
      },
    ]);
  });

  it('adds memory items', async () => {
    const mockVectorStore = {
      addDocuments: jest.fn(),
      similaritySearch: jest.fn(),
    } as unknown as VectorStore;
    const mockTextSplitter = {
      splitDocuments: jest.fn().mockResolvedValue([
        {
          pageContent: 'doc1',
          metadata: {
            date: 1000,
          },
        },
        {
          pageContent: 'doc2',
          metadata: {
            date: 2000,
          },
        },
      ]),
    } as unknown as TextSplitter;
    const ltm = new LangChainLtm({
      vectorStore: mockVectorStore,
      textSplitter: mockTextSplitter,
      maxResults: 5,
    });
    const memoryItems: MemoryItem[] = [
      {
        page: 'doc1',
        date: new Date(1000),
      },
      {
        page: 'doc2',
        date: new Date(2000),
      },
    ];
    await ltm.addMemoryItems(memoryItems);
    expect(mockVectorStore.addDocuments).toHaveBeenCalledTimes(1);
    expect(mockVectorStore.addDocuments).toHaveBeenCalledWith([
      {
        pageContent: 'doc1',
        metadata: {
          date: 1000,
        },
      },
      {
        pageContent: 'doc2',
        metadata: {
          date: 2000,
        },
      },
    ]);
  });

  it('searches and returns results', async () => {
    const mockVectorStore = {
      addDocuments: jest.fn(),
      similaritySearch: jest.fn().mockResolvedValue([
        {
          pageContent: 'result2',
          metadata: { date: 1000 },
        },
        {
          pageContent: 'result0',
          metadata: { date: 3000 },
        },
        {
          pageContent: 'result1',
          metadata: { date: 2000 },
        },
        {
          pageContent: 'result3',
          metadata: { date: 500 },
        },
      ]),
    } as unknown as VectorStore;
    const mockTextSplitter = {
      splitDocuments: jest.fn(),
    } as unknown as TextSplitter;
    const ltm = new LangChainLtm({
      vectorStore: mockVectorStore,
      textSplitter: mockTextSplitter,
      maxResults: 3,
    });
    const query = 'test-query';
    const results = await ltm.search(query);
    expect(mockVectorStore.similaritySearch).toHaveBeenCalledTimes(1);
    expect(mockVectorStore.similaritySearch).toHaveBeenCalledWith(query);
    expect(results).toEqual([
      {
        page: 'result0',
        date: new Date(3000),
      },
      {
        page: 'result1',
        date: new Date(2000),
      },
      {
        page: 'result2',
        date: new Date(1000),
      },
    ]);
  });
});
