import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WikipediaSensor } from './wikipedia-sensor.js';
import type { Provider } from '../types/provider.js';

describe('WikipediaSensor', () => {
  let mockProvider: Provider;

  beforeEach(() => {
    mockProvider = {
      askYesNoQuestion: vi.fn(),
      generate: vi.fn(),
      rankByRelevance: vi.fn(),
      splitString: vi.fn(),
      generateWithTools: vi.fn(),
    };
  });

  describe('sense method', () => {
    it('should fetch a random article, get content, and summarize it', async () => {
      // Mock fetch for random article
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('action=query&list=random')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  query: { random: [{ title: 'Albert Einstein' }] },
                }),
            });
          }
          if (url.includes('action=query&prop=extracts')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  query: {
                    pages: {
                      12345: {
                        extract:
                          'Albert Einstein was a German-born theoretical physicist, widely acknowledged to be one of the greatest and most influential physicists of all time. Born in Ulm, in 1879, he is best known for developing the theory of relativity.',
                      },
                    },
                  },
                }),
            });
          }
          return Promise.resolve({ ok: false });
        }),
      );

      vi.mocked(mockProvider.generate).mockResolvedValue(
        'Albert Einstein was a renowned German-born theoretical physicist (1879-1955), famous for developing the theory of relativity and making groundbreaking contributions to quantum mechanics.',
      );

      const sensor = new WikipediaSensor(mockProvider);
      const result = await sensor.sense();

      // Verify fetch was called with correct URLs
      expect(fetch).toHaveBeenCalledTimes(2);

      // Verify provider.generate was called for summarization
      expect(mockProvider.generate).toHaveBeenCalled();
      const generateCall = vi.mocked(mockProvider.generate).mock.calls[0]?.[0];
      expect(generateCall?.systemPrompt).toContain('summarize');
      expect(generateCall?.messages[0]?.content).toContain(
        'Albert Einstein was a German-born theoretical physicist',
      );

      // Verify result contains article title and summary
      expect(result).toContain('Albert Einstein');
      expect(result).toContain(
        'Albert Einstein was a renowned German-born theoretical physicist',
      );

      vi.unstubAllGlobals();
    });

    it('should throw if random article fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve({ ok: false })),
      );

      const sensor = new WikipediaSensor(mockProvider);

      await expect(sensor.sense()).rejects.toThrow(
        'Failed to fetch random article',
      );

      vi.unstubAllGlobals();
    });

    it('should throw if content fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('action=query&list=random')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({ query: { random: [{ title: 'Test' }] } }),
            });
          }
          return Promise.resolve({ ok: false });
        }),
      );

      const sensor = new WikipediaSensor(mockProvider);

      await expect(sensor.sense()).rejects.toThrow(
        'Failed to fetch article content',
      );

      vi.unstubAllGlobals();
    });

    it('should properly encode the article title in fetch URL', async () => {
      const encodedTitle = 'Special%20Article%20Name';

      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('action=query&list=random')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  query: { random: [{ title: encodedTitle }] },
                }),
            });
          }
          // Check that the title is properly encoded
          expect(url).toContain(encodeURIComponent(encodedTitle));
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                query: {
                  pages: { 123: { extract: 'Test content' } },
                },
              }),
          });
        }),
      );

      vi.mocked(mockProvider.generate).mockResolvedValue('Summary');

      const sensor = new WikipediaSensor(mockProvider);
      await sensor.sense();

      vi.unstubAllGlobals();
    });

    it('should handle empty article extract', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('action=query&list=random')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({ query: { random: [{ title: 'Empty' }] } }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                query: { pages: { 123: { extract: '' } } },
              }),
          });
        }),
      );

      vi.mocked(mockProvider.generate).mockResolvedValue('');

      const sensor = new WikipediaSensor(mockProvider);
      const result = await sensor.sense();

      expect(result).toContain('Empty');
      expect(result).toContain('\n\nSummary:\n');

      vi.unstubAllGlobals();
    });
  });

  describe('summarizeArticle method', () => {
    it('should call provider.generate with proper system prompt and messages', async () => {
      const content = 'Test article content about physics.';

      vi.mocked(mockProvider.generate).mockResolvedValue('Summary');

      const sensor = new WikipediaSensor(mockProvider);
      // Access private method via type assertion
      await (
        sensor as unknown as {
          summarizeArticle: (content: string) => Promise<string>;
        }
      ).summarizeArticle(content);

      expect(mockProvider.generate).toHaveBeenCalled();
      const generateCall = vi.mocked(mockProvider.generate).mock.calls[0]?.[0];
      expect(generateCall?.systemPrompt).toContain(
        'expert editor and summarizer',
      );
      expect(generateCall?.messages[0]?.content).toContain('Please summarize');
      expect(generateCall?.messages[0]?.content).toContain(content);
    });
  });
});
