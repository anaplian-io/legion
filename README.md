# Legion Design

> Group intelligence AI agent system based on Global Workspace Theory

## Overview

Legion implements a distributed cognitive architecture inspired by **Global Workspace Theory (GWT)**, where specialized "unconscious" processors compete for attention and broadcast to a global workspace.

### Core Principles (from GWT)

- **Unconscious processors**: Specialized agents that operate without central control
- **Attention as spotlight**: A filter mechanism selects which information enters working memory
- **Global broadcast**: Winning content is broadcast to all nodes
- **Fleeting working memory**: ~10 messages, short-term retention (few seconds)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Global Workspace                         │
│              (Rolling window of N messages)                 │
└───────────────────┬─────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │ Node A │ │ Node B │ │ Node C │ ... (N nodes)
   └────────┘ └────────┘ └────────┘
        ▲           ▲           ▲
        └───────────┴───────────┘
              Filter/Ranker
         (LLM-based relevance scorer)
```

### Key Components

| Component              | Description                                        | Status  |
| ---------------------- | -------------------------------------------------- | ------- |
| **Nodes**              | Sub-agents with specialized knowledge/context      | ✅ Done |
| **Filter**             | LLM-based relevance scorer that ranks broadcasts   | ✅ Done |
| **Working Memory**     | Rolling window of recent broadcasts (configurable) | ✅ Done |
| **Distiller**          | Converts successful broadcasts into WM entry       | ✅ Done |
| **Epoch Orchestrator** | Coordinates the full epoch cycle                   | ✅ Done |
| **AttentionGate**      | Dynamic top-K selection for broadcasts             | ✅ Done |
| **Node Splitter**      | LLM-based context splitting on overflow            | ✅ Done |
| **ToolNode**           | LLM tool invocation via Model Context Protocol     | ✅ Done |

## Concepts

### Nodes

Nodes are the primary computational units. Each node:

- Has its own identity (`id`, `name`)
- Maintains its own context/history (implicit memory)
- Runs a lightweight LLM (optimized for token caching)
- Receives broadcasts and determines relevance

**Node lifecycle:**

1. **Birth**: Node created with initial instructions/context
2. **Growth**: Context grows through relevant broadcasts
3. **Split**: On overflow, node splits by topic clustering (LLM-based)
4. **Decay**: Context can be pruned via compaction

### Working Memory

- Small, rolling window of messages (default: 10)
- Configurable capacity based on task demands
- Dynamic scheduling via a function that determines broadcast acceptance

### Filter

The filter is the attention mechanism. It:

1. Receives all node outputs from an epoch
2. Ranks broadcasts by relevance to working memory using LLM
3. Returns ranked indices (no scores needed)
4. AttentionGate trims to top-K broadcasts

**Relevance ranking prompt:**

```
You are a relevance ranking assistant. Given a concept and a list of items,
return the items ranked from most to least relevant to the concept.

Concept: [concatenated working memory]

Items:
0: [broadcast from node A]
1: [broadcast from node B]
...

Respond with ONLY a JSON array of the original indices in order of relevance.
Example: {"rankedIndices": [2, 0, 1]}
```

### Distillation

After filtering, a distillation step converts successful broadcasts into a new working memory entry. This is the "conscious consolidation" phase.

**Distillation prompt:**

```
You are a working memory distiller. Convert the following successful
broadcasts into a concise new working memory entry.

Working Memory (last 10 messages):
...

Broadcasts from this epoch:
- Node A: ...
- Node B: ...

Output: One concise message that captures key insights for next epoch.
```

## Types of Nodes

### IO Nodes (Preconfigured)

Static nodes for input/output:

| Node Type   | Purpose                                       |
| ----------- | --------------------------------------------- |
| `io/input`  | Receives external user input                  |
| `io/output` | Formats and outputs results                   |
| `io/query`  | Specialized LLM for querying external sources |

### Emergent Nodes

Created dynamically through:

- **Topic splitting**: When context overflows
- **Specialization**: When patterns emerge in task processing
- **Bootstrapping**: When all nodes remain silent, generate new node from WM

## Epoch Cycle

Each epoch runs in two sequential waves — **afferent** (perception) then
**cognitive** (reasoning) — modeling sensory input feeding the global workspace
rather than competing within it:

```
Afferent wave
1. Poll afferent nodes (tools, sensors) with WM + broadcast
2. Collect their outputs as afferent context

Cognitive wave
3. Poll memory nodes with WM + afferent context + broadcast
4. Filter ranks the memory outputs by relevance to working memory
5. Top broadcasts selected for propagation
6. Distillation creates new WM entry from successful broadcasts
7. Working memory updates (rolling window with max capacity)
8. Context length threshold check: nodes exceeding threshold are split
9. Underperforming memory nodes are pruned
10. If no memory node responded: spawn a new MemoryNode via factory, seeded with current WM context
11. Next epoch begins
```

**Afferent context is not filtered.** Tool/sensor output flows to every memory
node as additional context, but is never a broadcast candidate — only memory
outputs compete for the spotlight (distillation). This keeps a single
bottleneck (consistent with GWT) and maximizes cross-pollination: a memory node
that engages afferent input still updates its own context even when its output
does not win the spotlight. Memory nodes see the prompt prefix
`[identity + context][working memory][afferent context][broadcast]`.

**Initial Broadcast**: The orchestrator requires an `initialBroadcast` message passed at construction time. This addresses the fencepost problem - epochs start with this broadcast rather than reading from working memory.

### Node Splitting

When a node's context exceeds the configured threshold:

1. The splitter uses LLM to analyze and intelligently split the context
2. Two new nodes are created with focused, coherent contexts
3. Original node is replaced by the two split nodes
4. New nodes receive their own provider for runtime operations

## Edge Cases

### No Memory Node Survives

When no memory output survives the relevance filter (`survivors.length === 0`),
even if afferent nodes produced output:

- **Bootstrap**: Spawn a new MemoryNode using the factory, seeded with current working memory (or initial broadcast if WM is empty)
- Each node gets a unique UUID via `crypto.randomUUID()`
- The new node receives the concatenated WM messages as its initial context
- Epoch ends after spawning; next epoch will include the new node

Because afferent output is no longer a broadcast candidate, an epoch in which
only a tool/sensor responded cleanly bootstraps a memory node rather than
dropping the work — the orphan case the single-wave design exhibited.

### Empty Filtered Messages

When all candidate messages are filtered out by relevance:

- **Next Epoch**: Working memory remains unchanged
- No distillation occurs
- Nodes retain their context; they may respond in future epochs if relevant

### Node Pruning Triggers

After each epoch, the orchestrator accumulates per-node stats (`epochsAlive`,
`epochsSpoken`, `epochsFiltered`) and the `NodePruner` removes memory nodes
that, once past a grace period, are underperforming. Implemented by
`StaticNodePruner`:

- A node is eligible only after `minEpochsAlive` epochs (grace period prevents
  spawn/prune thrashing of freshly created nodes).
- Among eligible nodes, prune any that:
  - Spoke in fewer than `minBroadcasts` epochs (inert), OR
  - Were filtered in more than `maxFilterRate * 100%` of the epochs they spoke
    (low-signal).
- A `minMemoryNodes` floor is always enforced; when more nodes qualify than the
  floor permits, the worst performers (highest filter rate) are dropped first.

Split children and spawned nodes start with fresh stats (and thus a full grace
period). Stats are published on the `orchestrator/node-stats-updated` event for
visibility.

> **Note:** the originally specified `minRelevanceScore` trigger is deferred.
> The relevance filter returns ranked indices rather than scalar scores, so a
> true average relevance score is not currently measurable; filter rate serves
> as the quality signal instead.

### Node Bootstrap from WM

When no nodes have anything to say, use LLM to:

1. Analyze current WM for gaps/knowledge needs
2. Generate new node instructions for the missing perspective

## Technology Stack

| Component | Choice                                          |
| --------- | ----------------------------------------------- |
| Runtime   | Node.js + TypeScript (ESM)                      |
| Testing   | Vitest                                          |
| LLM API   | OpenAI SDK (supports LM Studio compatible APIs) |

## Development Phases

### Phase 1: Node Implementation ✅ COMPLETE

- [x] Define Node interface (`src/types/node.ts`)
- [x] Implement Provider adapters for LM Studio (`src/provider/openai-provider.ts`)
- [x] Create MemoryNode implementation (`src/node/memory-node.ts`)

### Phase 2: Filter & Working Memory ✅ COMPLETE

- [x] Implement relevance filter (`src/service/llm-relevance-filter.ts`)
- [x] Create working memory interface (`src/types/working-memory.ts`)
- [x] Add attention gate for dynamic ranking (`src/types/attention-gate.ts`)
- [x] Implement relevance ranking via LLM (returns indices, not scores)
- Tests: `src/node/memory-node.test.ts`, `src/service/llm-relevance-filter.test.ts`

### Phase 3: Epoch Orchestration ✅ COMPLETE

- [x] Integrate filter into epoch cycle
- [x] Implement broadcast propagation
- [x] Test multi-node communication
- [x] Implement distiller interface and LLM-based implementation
- Tests: `src/orchestration/epoch-orchestrator.test.ts`, `src/service/llm-distiller.test.ts`

### Phase 4: Node Splitting ✅ COMPLETE

- [x] Add `splitString` method to Provider interface
- [x] Implement LLM-based context splitting in OpenaiProvider
- [x] Create MemoryNodeSplitter with two-provider pattern
- [x] Integrate splitting into epoch cycle via threshold check
- Tests: `src/service/memory-node-splitter.test.ts`

### Phase 5: Static Implementations for Testing ✅ COMPLETE

- [x] Implement StaticAttentionGate for deterministic testing
- [x] All interfaces have minimal implementations
- [x] 100% test coverage achieved (46 tests, 117/117 lines)

### Phase 6: IO Nodes and ToolNode with MCP ✅ COMPLETE

- [x] Implement SensoryNode for external input via Sensor interface (`src/node/sensory-node.ts`)
- [x] Implement ToolNode for LLM tool invocation via Model Context Protocol (`src/node/tool-node.ts`)
- [x] Create MCPClient wrapper around SDK Client (`src/adapter/mcp-client.ts`)
- [x] Integrate with EpochOrchestrator for single-phase tool calling (tool results are broadcast raw; LLM synthesis of results is not yet implemented)
- [x] Implement ConcreteToolNodeFactory with proper dependency injection
- [x] Add shutdown method to MCPClient with error handling
- Tests: `src/node/tool-node.test.ts`, `src/node/sensory-node.test.ts`, `src/mcp/mcp-client.test.ts`, `src/factory/concrete-tool-node-factory.test.ts`

### Phase 7: TUI Layer (Future) ⏳ TODO

- [ ] Ink-based terminal UI
- [ ] Real-time node activity visualization

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
