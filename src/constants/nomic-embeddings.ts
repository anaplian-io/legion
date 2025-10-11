import { EmbeddingsInterface } from '@langchain/core/embeddings';
import { OpenAIClient } from '@langchain/openai';

const model = 'text-embedding-nomic-embed-text-v1.5';
const lmStudioOpenAi = new OpenAIClient({
  apiKey: 'NA',
  baseURL: 'http://127.0.0.1:1234/v1',
});

export const NomicEmbeddings: EmbeddingsInterface = {
  async embedDocuments(documents: string[]): Promise<number[][]> {
    const result = await lmStudioOpenAi.embeddings.create({
      input: documents.map((document) => `search_document: ${document}`),
      encoding_format: 'base64',
      model,
    });
    return result.data.map((data) => data.embedding);
  },
  async embedQuery(document: string): Promise<number[]> {
    const result = await lmStudioOpenAi.embeddings.create({
      input: [`search_query: ${document}`],
      encoding_format: 'base64',
      model,
    });
    return result.data[0]!.embedding;
  },
};
