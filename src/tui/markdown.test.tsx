import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Markdown, stripMarkdown } from './markdown.js';

const frameOf = (text: string): string => {
  const { lastFrame } = render(<Markdown text={text} />);
  return lastFrame() ?? '';
};

describe('Markdown', () => {
  it('renders headings, paragraphs, and emphasis', () => {
    const out = frameOf(
      '# Title\n\nSome **bold** and *italic* and `code` text.',
    );
    expect(out).toContain('Title');
    expect(out).toContain('bold');
    expect(out).toContain('italic');
    expect(out).toContain('code');
  });

  it('renders strikethrough, links, and a horizontal rule', () => {
    const out = frameOf('~~gone~~ [label](https://example.com)\n\n---');
    expect(out).toContain('gone');
    expect(out).toContain('label');
    expect(out).toContain('─');
  });

  it('renders fenced code blocks line by line', () => {
    const out = frameOf('```\nline one\n\nline three\n```');
    expect(out).toContain('line one');
    expect(out).toContain('line three');
  });

  it('renders blockquotes with a gutter', () => {
    const out = frameOf('> quoted text');
    expect(out).toContain('quoted text');
    expect(out).toContain('│');
  });

  it('renders ordered and nested unordered lists', () => {
    const out = frameOf('1. first\n2. second\n   - nested');
    expect(out).toContain('1.');
    expect(out).toContain('2.');
    expect(out).toContain('first');
    expect(out).toContain('nested');
    expect(out).toContain('•');
  });

  it('renders tables as labeled records', () => {
    const out = frameOf('| Name | Role |\n| ---- | ---- |\n| Ada | Pioneer |');
    expect(out).toContain('Name');
    expect(out).toContain('Ada');
    expect(out).toContain('Role');
    expect(out).toContain('Pioneer');
  });

  it('renders inline line breaks and escapes', () => {
    const out = frameOf('a\\*b line one  \nline two');
    expect(out).toContain('line one');
    expect(out).toContain('line two');
  });

  it('renders an explicit <br> as a line break', () => {
    const out = frameOf('before<br>after');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('accepts a custom base color without throwing', () => {
    const { lastFrame } = render(<Markdown text="plain" color="green" />);
    expect(lastFrame()).toContain('plain');
  });

  it('renders an inline token type without a dedicated case (image)', () => {
    // An image is an inline token the switch does not special-case; it falls
    // through to the default branch.
    const { lastFrame } = render(
      <Markdown text="![alt text](http://x/i.png)" />,
    );
    expect(lastFrame()).toContain('alt text');
  });

  it('renders a block token type without a dedicated case (raw HTML)', () => {
    // A raw HTML block hits the block-level default branch.
    const { lastFrame } = render(<Markdown text="<div>raw html block</div>" />);
    expect(lastFrame()).toContain('raw html block');
  });

  it('renders an empty document without throwing', () => {
    const { lastFrame } = render(<Markdown text="" />);
    expect(lastFrame()).toBe('');
  });

  it('drops non-break inline HTML while keeping surrounding text', () => {
    // Inline <span> is not <br>, so the html case returns null; the text around
    // it still renders.
    const { lastFrame } = render(
      <Markdown text="before <span>x</span> after" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('renders a bare text paragraph (no nested inline tokens)', () => {
    const { lastFrame } = render(<Markdown text="just plain words" />);
    expect(lastFrame()).toContain('just plain words');
  });

  it('renders a loose list item containing block content', () => {
    // A loose list (blank line between items) yields paragraph-wrapped item
    // content, exercising nested block rendering inside list items.
    const out = frameOf('- one\n\n- two\n');
    expect(out).toContain('one');
    expect(out).toContain('two');
  });
});

describe('stripMarkdown', () => {
  it('flattens formatting to plain text', () => {
    expect(stripMarkdown('# Hi **there**')).toBe('Hi there');
  });

  it('collapses whitespace and trims', () => {
    expect(stripMarkdown('a\n\n   b   c')).toBe('a b c');
  });

  it('replaces inline breaks/html with spaces', () => {
    expect(stripMarkdown('one<br>two')).toContain('one');
    expect(stripMarkdown('one<br>two')).toContain('two');
  });

  it('handles links and code spans', () => {
    expect(stripMarkdown('see [docs](https://x.io) and `code`')).toContain(
      'docs',
    );
  });

  it('returns empty string for empty input', () => {
    expect(stripMarkdown('')).toBe('');
  });
});
