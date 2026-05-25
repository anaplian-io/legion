import { Provider } from '../types/provider.js';
import { Sensor } from '../types/sensor.js';

export class WikipediaSensor implements Sensor {
  constructor(private readonly provider: Provider) {}

  public async sense(): Promise<string> {
    const articleTitle = await this.fetchRandomWikiArticle();
    const articleContent = await this.fetchWikiContent(articleTitle);
    const summary = await this.summarizeArticle(articleContent);

    return `Wikipedia Article: ${articleTitle}\n\nSummary:\n${summary}`;
  }

  private async fetchRandomWikiArticle(): Promise<string> {
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&format=json';

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch random article: ${response.statusText}`);
    }
    const data = (await response.json()) as {
      query: { random: { title: string }[] };
    };
    return data.query.random[0]!.title;
  }

  private async fetchWikiContent(title: string): Promise<string> {
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=&explaintext=&titles=${encodeURIComponent(title)}&format=json`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch article content: ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      query: { pages: Record<string, { extract: string }> };
    };
    return (
      data.query.pages[Object.keys(data.query.pages)[0]!] as { extract: string }
    ).extract;
  }

  private async summarizeArticle(content: string): Promise<string> {
    const systemPrompt = `You are an expert editor and summarizer. Your task is to read a Wikipedia article excerpt and provide a thorough, well-structured summary that captures all key information while remaining concise and readable.

Requirements:
- Identify the main topic and significance
- Extract key facts, dates, names, and events
- Maintain factual accuracy
- Use clear, accessible language
- Keep important context and cause-effect relationships
- Aim for ~300-500 words for a comprehensive summary`;

    const messages = [
      {
        content: `Please summarize the following Wikipedia article excerpt:

${content}`,
      },
    ];

    return await this.provider.generate({ systemPrompt, messages });
  }
}
