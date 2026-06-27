import React from 'react';
import { Box, Text } from 'ink';
import { marked, type Token, type Tokens } from 'marked';

/**
 * Markdown for the TUI: `marked` does the parsing (robust on nested emphasis,
 * ordered/nested lists, fenced code, links, escapes), and we map its tokens to
 * Ink primitives so layout/wrapping stays Ink-native. No ANSI string rendering.
 */

const HR = '─'.repeat(48);

const renderInline = (
  tokens: Token[] | undefined,
  baseColor: string,
): React.ReactNode[] => {
  /* v8 ignore next 3 -- defensive guard for an absent token list */
  if (!tokens) {
    return [];
  }
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'strong':
        return (
          <Text key={i} bold color="whiteBright">
            {renderInline(token.tokens, 'whiteBright')}
          </Text>
        );
      case 'em':
        return (
          <Text key={i} italic color={baseColor}>
            {renderInline(token.tokens, baseColor)}
          </Text>
        );
      case 'del':
        return (
          <Text key={i} strikethrough color={baseColor}>
            {renderInline(token.tokens, baseColor)}
          </Text>
        );
      case 'codespan':
        return (
          <Text key={i} color="greenBright">
            {token.text}
          </Text>
        );
      case 'link':
        return (
          <Text key={i} underline color="blueBright">
            {renderInline(token.tokens, 'blueBright')}
          </Text>
        );
      case 'br':
        return <Text key={i}>{'\n'}</Text>;
      case 'html': {
        // Inline HTML: turn <br> into a line break, drop other tags.
        const raw = (token as Tokens.HTML).raw.trim();
        return /^<br\s*\/?>$/i.test(raw) ? <Text key={i}>{'\n'}</Text> : null;
      }
      case 'escape':
        return (
          <Text key={i} color={baseColor}>
            {token.text}
          </Text>
        );
      case 'text':
        // Inline text tokens from `marked` carry no nested tokens.
        return (
          <Text key={i} color={baseColor}>
            {token.text}
          </Text>
        );
      case 'image':
        return (
          <Text key={i} color={baseColor}>
            {token.text}
          </Text>
        );
      /* v8 ignore next 7 -- catch-all for inline token types marked does not emit here */
      default:
        return (
          <Text key={i} color={baseColor}>
            {token.raw}
          </Text>
        );
    }
  });
};

const renderBlocks = (
  tokens: Token[],
  baseColor: string,
  depth = 0,
): React.ReactNode[] => {
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'heading':
        return (
          <Text key={i} bold color="cyanBright" wrap="wrap">
            {renderInline(token.tokens, 'cyanBright')}
          </Text>
        );
      case 'paragraph':
        return (
          <Text key={i} color={baseColor} wrap="wrap">
            {renderInline(token.tokens, baseColor)}
          </Text>
        );
      case 'text':
        // Block-level text tokens carry inline tokens; renderInline tolerates
        // an absent list (see its guard), so no branch is needed here.
        return (
          <Text key={i} color={baseColor} wrap="wrap">
            {renderInline(token.tokens, baseColor)}
          </Text>
        );
      case 'space':
        return <Text key={i}> </Text>;
      case 'hr':
        return (
          <Text key={i} color="gray">
            {HR}
          </Text>
        );
      case 'code': {
        const code = token as Tokens.Code;
        return (
          <Box key={i} flexDirection="column" paddingLeft={1}>
            {code.text.split('\n').map((line, j) => (
              <Text key={j} color="greenBright">
                {line.length > 0 ? line : ' '}
              </Text>
            ))}
          </Box>
        );
      }
      case 'blockquote': {
        const quote = token as Tokens.Blockquote;
        return (
          <Box key={i} flexDirection="column">
            {renderBlocks(quote.tokens, 'gray', depth).map((node, j) => (
              <Box key={j}>
                <Text color="gray">│ </Text>
                <Box flexDirection="column">{node}</Box>
              </Box>
            ))}
          </Box>
        );
      }
      case 'table': {
        // Tables don't fit a narrow column as ASCII grids — render each row as
        // a record: every cell labeled by its column header, content wrapped.
        const table = token as Tokens.Table;
        return (
          <Box key={i} flexDirection="column">
            {table.rows.map((row, r) => (
              <Box key={r} flexDirection="column" marginTop={1}>
                {table.header.map((headerCell, c) => (
                  <Box key={c} flexDirection="column">
                    <Text bold color="cyanBright" wrap="wrap">
                      {headerCell.text}
                    </Text>
                    <Text color={baseColor} wrap="wrap">
                      {renderInline(row[c]?.tokens, baseColor)}
                    </Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        );
      }
      case 'list': {
        const list = token as Tokens.List;
        const start = typeof list.start === 'number' ? list.start : 1;
        return (
          <Box key={i} flexDirection="column" paddingLeft={depth > 0 ? 2 : 0}>
            {list.items.map((item, j) => (
              <Box key={j}>
                <Text color={baseColor}>
                  {list.ordered ? `${start + j}.` : '•'}{' '}
                </Text>
                <Box flexDirection="column">
                  {renderBlocks(item.tokens, baseColor, depth + 1)}
                </Box>
              </Box>
            ))}
          </Box>
        );
      }
      default:
        return (
          <Text key={i} color={baseColor} wrap="wrap">
            {token.raw}
          </Text>
        );
    }
  });
};

export interface MarkdownProps {
  readonly text: string;
  readonly color?: string;
}

export const Markdown: React.FC<MarkdownProps> = ({ text, color = 'gray' }) => {
  return <>{renderBlocks(marked.lexer(text), color)}</>;
};

/**
 * Plain-text projection for single-line truncated views — uses the same parser
 * so it stays consistent with the rendered output.
 */
export const stripMarkdown = (text: string): string => {
  const flatten = (tokens: Token[]): string =>
    tokens
      .map((token) => {
        if (token.type === 'html' || token.type === 'br') {
          return ' ';
        }
        if ('tokens' in token && token.tokens) {
          return flatten(token.tokens);
        }
        if ('text' in token) {
          return token.text as string;
        }
        return token.raw;
      })
      .join(' ');
  return flatten(marked.lexer(text)).replace(/\s+/g, ' ').trim();
};
