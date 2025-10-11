import { SavingMemoryVectorStore } from './saving-memory-vector-store.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

type EmbeddingsInterface = {
  embed: (texts: string[]) => Promise<number[][]>;
  embedDocuments: (documents: string[]) => Promise<number[][]>;
  embedQuery: (query: string) => Promise<number[]>;
};

describe('SavingMemoryVectorStore', () => {
  it('loads prior vectors', () => {
    const dummy: EmbeddingsInterface = {
      embed: async () => [],
      embedDocuments: async () => [],
      embedQuery: async () => [],
    };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
    const fileName = 'vectors.json';
    const vectors = [{ content: 'doc1', embedding: [0, 1], metadata: {} }];
    fs.writeFileSync(path.join(tempDir, fileName), JSON.stringify(vectors));
    const store = SavingMemoryVectorStore.fromExisting({
      directory: tempDir,
      fileName,
      embeddingsModel: dummy,
    });
    expect(store.memoryVectors).toStrictEqual(vectors);
    expect(store).toBeInstanceOf(SavingMemoryVectorStore);
  });

  it('fails to load prior vectors', () => {
    const dummy: EmbeddingsInterface = {
      embed: async () => [],
      embedDocuments: async () => [],
      embedQuery: async () => [],
    };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
    const fileName = 'vectors.json';
    const store = SavingMemoryVectorStore.fromExisting({
      directory: tempDir,
      fileName,
      embeddingsModel: dummy,
    });
    expect(store.memoryVectors.length).toBe(0);
    expect(store).toBeInstanceOf(SavingMemoryVectorStore);
  });

  it('writes vectors to file', async () => {
    const dummy: EmbeddingsInterface = {
      embed: async (texts) => texts.map(() => [0, 1]),
      embedDocuments: async () => [],
      embedQuery: async () => [],
    };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
    const fileName = 'vectors.json';
    const store = new SavingMemoryVectorStore({
      fileName,
      embeddingsModel: dummy,
    });
    store.memoryVectors = [
      {
        embedding: [1, 2, 3, 4],
        content: 'not-interesting-content',
        metadata: {},
      },
    ];
    await store.save(tempDir);
    const data = JSON.parse(
      fs.readFileSync(path.join(tempDir, fileName), 'utf-8'),
    );
    expect(data.length).toBe(1);
    expect(data[0].content).toBe('not-interesting-content');
  });
});
