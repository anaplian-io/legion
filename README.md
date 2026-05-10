# Legion

> Group intelligence AI agent system

A TypeScript-based framework for orchestrating multiple specialized agents that communicate through a central message bus. Inspired by the "subconscious" metaphor - fast small-model agents for intuition/routing, slow laborious models for deep reasoning.

## Status

Currently in **Phase 0: Housekeeping** - cleaning up dependencies and tooling.

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│           Orchestrator (Main Loop)          │
├─────────────────────────────────────────────┤
│  Fast Tier (Quick Processing)               │
│  ├─ Router Agent      - Routes tasks        │
│  ├─ Filter Agent      - Initial screening   │
│  └─ Formatter Agent   - Initial formatting  │
│                                             │
│  Slow Tier (Deep Reasoning)                 │
│  ├─ Analyzer Agent    - Deep analysis       │
│  └─ Verifier Agent    - Validation/Refine   │
└─────────────────────────────────────────────┘
```

### Key Concepts

- **Agents**: Individual AI processors with their own identity and memory
- **Message Bus**: Central pub/sub system for agent communication
- **Topics**: Channels agents subscribe to (e.g., `#research`, `#verification`)
- **Epochs**: One "thought cycle" - broadcast prompt, collect responses
- **Memory**: Persistent storage beyond context windows

## Technology Stack

| Component | Choice                             |
| --------- | ---------------------------------- |
| Runtime   | Node.js + TypeScript (ESM)         |
| Testing   | Vitest                             |
| LLM API   | OpenAI SDK (supports LM Studio)    |
| TUI       | Ink (React for CLI) - future phase |

## Development Phases

### Phase 0: Housekeeping (Current)

- [x] Remove `@openai/agents` dependency
- [x] Remove LangChain dependency
- [x] Replace Jest with Vitest (ESM-first)
- [ ] Create minimal Agent interface
- [ ] Create Provider adapters (OpenAI, Anthropic)
- [ ] Document architecture in README

### Phase 1: Minimal Agent Interface

- [ ] Define minimal Agent interface (`src/agent/types.ts`)
- [ ] Implement Provider adapters for LM Studio
- [ ] Create memory abstraction (no LangChain)

### Phase 2: Message Bus & Orchestration

- [ ] Implement pub/sub message bus
- [ ] Create orchestrator for agent management
- [ ] Test multi-agent communication

### Phase 3: Subconscious Architecture

- [ ] Implement fast/slow tier delegation
- [ ] Add memory persistence layer

### Phase 4: TUI Layer

- [ ] Build Ink-based terminal UI
- [ ] Real-time agent activity visualization

## Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Lint and format
npm run lint
npm run format
```

## Configuration

Create a `.env` file:

```bash
# LM Studio (OpenAI-compatible)
OPENAI_API_KEY=NA
OPENAI_BASE_URL=http://127.0.0.1:1234/v1

# Optional: Anthropic API for other providers
ANTHROPIC_API_KEY=your-key-here
```

## Contributing

See `CONTRIBUTING.md` for detailed development plan and phase breakdown.
