# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Development Commands

```bash
npm install        # Install dependencies
npm test           # Run tests with coverage
npm run test       # Run tests
npm run build      # Compile TypeScript to dist/
npm run lint       # Run ESLint and Prettier check
npm run format     # Auto-fix with ESLint and Prettier
npm run release    # CI-ready command: clean install, lint, build, test
```

To run a single test file: `npx vitest src/node/memory-node.test.ts`

## Architecture

### Global Workspace Theory Implementation

Legion implements a distributed cognitive architecture inspired by **Global Workspace Theory (GWT)**:

- **Nodes** (`src/types/node.ts`): Sub-agents with specialized knowledge that receive broadcasts and respond if relevant
- **Working Memory** (`src/types/working-memory.ts`): Rolling window of recent broadcasts (default 10 messages)
- **Filter** (`src/service/llm-relevance-filter.ts`): LLM-based relevance scorer that ranks broadcasts by relevance to WM
- **Distiller** (`src/service/llm-distiller.ts`): Converts successful broadcasts into new WM entries
- **AttentionGate** (`src/types/attention-gate.ts`): Dynamic top-K selection for broadcast propagation

### Epoch Cycle

Each epoch processes one broadcast through:

1. Broadcast initial message to all nodes
2. Nodes generate responses (or undefined if not relevant)
3. Filter ranks outputs by relevance to working memory
4. Top broadcasts selected via AttentionGate
5. Distillation creates new WM entry from successful broadcasts
6. Working memory updates with rolling window
7. Context overflow triggers node splitting
8. Empty response spawns new MemoryNode

### Provider Pattern (`src/provider/`)

All LLM interactions go through the `Provider` interface (`src/types/provider.ts`):

- `generate`: Standard chat completion with system prompt
- `rankByRelevance`: Returns array of indices (most to least relevant)
- `askYesNoQuestion`: Boolean response via JSON schema
- `splitString`: Splits content into two coherent parts

Uses OpenAI SDK (compatible with LM Studio APIs).

## Coding Standards & Constraints

- **NO EXPLICIT ANY**: The use of `any` is strictly prohibited. Always use specific types or generics to ensure type safety.
- **Error Handling**: Prioritize descriptive errors over generic ones.
- **Testing**: 100% coverage thresholds are enforced via Vitest.

## Testing Strategy

- **Vitest** with globals enabled
- 100% coverage thresholds enforced
- Mock providers for unit tests (`vi.mocked()`)
- Static implementations for deterministic testing (`StaticAttentionGate`)
