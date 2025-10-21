import { SaveableVectorStore } from '@langchain/core/vectorstores';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import * as fs from 'node:fs';
import path from 'node:path';
import { EmbeddingsInterface } from '@langchain/core/embeddings';

export interface SavingMemoryVectorStoreProps {
  readonly fileName: string;
  readonly embeddingsModel: EmbeddingsInterface;
}

export class SavingMemoryVectorStore
  extends MemoryVectorStore
  implements SaveableVectorStore
{
  static fromExisting = (
    props: SavingMemoryVectorStoreProps & { readonly directory: string },
  ): SavingMemoryVectorStore => {
    const vectorStore = new SavingMemoryVectorStore(props);
    try {
      vectorStore.memoryVectors = JSON.parse(
        fs.readFileSync(path.join(props.directory, props.fileName), 'utf-8'),
      );
    } catch (e) {
      console.warn(`Failed to load existing long term memory: ${e}`);
    }
    return vectorStore;
  };

  constructor(private readonly props: SavingMemoryVectorStoreProps) {
    super(props.embeddingsModel);
  }

  public readonly save = async (directory: string): Promise<void> => {
    fs.writeFileSync(
      path.join(directory, this.props.fileName),
      JSON.stringify(this.memoryVectors),
    );
  };
}
