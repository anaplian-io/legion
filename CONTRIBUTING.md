# Contributing to Legion

## Development Phases

### Phase 0: Housekeeping (Current)

- [x] Remove `@openai/agents` dependency
- [x] Remove LangChain dependency
- [x] Replace Jest with Vitest (ESM-first)
- [ ] Create minimal Agent interface
- [ ] Create Provider adapters (OpenAI, Anthropic)
- [ ] Document architecture

### Phase 1: Minimal Agent Interface

- [ ] Define minimal Agent interface (`src/agent/types.ts`)
- [ ] Implement Provider adapters for LM Studio
- [ ] Create memory abstraction (no LangChain)

### Phase 2: Message Bus & Orchestration

- [ ] Implement pub/sub message bus (`src/orchestration/message-bus.ts`)
- [ ] Create orchestrator for agent management (`src/orchestration/orchestrator.ts`)
- [ ] Test multi-agent communication

### Phase 3: Subconscious Architecture

- [ ] Implement fast/slow tier delegation (`src/orchestration/subconscious.ts`)
- [ ] Add memory persistence layer

### Phase 4: TUI Layer

- [ ] Build Ink-based terminal UI (`src/tui/app.tsx`)
- [ ] Real-time agent activity visualization

## Project Structure

```
src/
├── agent/          # Agent interface and implementation
├── provider/       # LLM provider adapters (OpenAI, Anthropic)
├── types/          # Shared TypeScript types
├── orchestration/  # Message bus and agent coordination
├── memory/         # Persistent memory storage (Phase 1+)
├── tui/            # Terminal UI (Ink) - Phase 4
└── constants/      # Application constants
```

## Running Tests

```bash
npm test        # Run all tests
npm run test:watch  # Watch mode
```

## Building

```bash
npm run build   # Build TypeScript to dist/
```
