export interface MemoryItem {
  readonly page: string;
  readonly date: Date;
}

export interface LongTermMemoryStore {
  readonly addDocuments: (documents: string[]) => Promise<this>;
  readonly addMemoryItems: (memoryItems: MemoryItem[]) => Promise<this>;
  readonly search: (query: string) => Promise<MemoryItem[]>;
}
