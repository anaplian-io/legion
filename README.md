# Legion

> _"Every point of view is useful, even those that are wrong - if we can judge why a wrong view was accepted."_
>
> — Legion, _Mass Effect 2_

A group-intelligence agent. Legion is named for the Geth companion in _Mass
Effect_ — a single mobile platform housing 1,183 programs
that reach decisions by consensus. No one program is "Legion"; Legion is what
emerges when they run together. _"I am Legion, for we are many."_

This project was inspired by that idea. Many small, specialized language-model
nodes each hold a sliver of context. They perceive, deliberate, and compete for
a shared spotlight; the winning thought is broadcast back to all of them and
consolidated into collective memory. Intelligence is the emergent behavior of
the swarm, not any single node.

## Global Workspace Theory

The architecture is a computational reading of **Global Workspace Theory**
(GWT), a model of consciousness in which many unconscious, parallel processors
compete for access to a limited-capacity "global workspace." Whatever wins is
broadcast to the entire system; that broadcast _is_ the conscious moment.

Legion maps the theory onto running software:

| GWT concept                   | Legion                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| Unconscious processors        | **Nodes** — specialized sub-agents (`src/node/`)              |
| Sensory input                 | **Afferent nodes** — tools & sensors feeding perception       |
| Competition for the spotlight | **Relevance filter** + **attention gate** (`src/service/`)    |
| The conscious broadcast       | The **distilled** message propagated each epoch               |
| Working memory                | A rolling window of recent broadcasts (`WorkingMemoryBuffer`) |
| Learning / forgetting         | Node **splitting** (growth) and **pruning** (decay)           |

The design goal is a system that scales **horizontally** — more small nodes on
modest hardware — rather than vertically into one ever-larger model. It targets
local, OpenAI-compatible runtimes such as [LM Studio](https://lmstudio.ai/), and
prompt construction is tuned for prefix caching so a node's stable identity and
accumulated context are reused across calls.

## The epoch cycle

Time advances in **epochs**. Each epoch carries one broadcast through two
sequential waves — perception, then cognition — modelling sensory input feeding
the workspace rather than competing inside it.

```
                       ┌─────────────────────────────┐
   current broadcast ─▶│        AFFERENT WAVE        │
   + working memory    │   tools, sensors perceive   │
                       └──────────────┬──────────────┘
                                      │ afferent context
                                      ▼
                       ┌─────────────────────────────┐
                       │       COGNITIVE WAVE        │
                       │  memory nodes reason, each  │
                       │  deciding whether to speak  │
                       └──────────────┬──────────────┘
                                      │ candidate broadcasts
                                      ▼
                  relevance filter ─▶ attention gate ─▶ survivors
                                      │
                                      ▼
                        distiller → next broadcast
                                      │
                  working memory rolls · nodes split · nodes prune
```

1. **Afferent wave.** Tool and sensor nodes are polled with working memory and
   the current broadcast. Their outputs become _afferent context_.
2. **Cognitive wave.** Memory nodes are polled with that afferent context
   alongside working memory and the broadcast. Each node first decides whether
   it has something non-redundant to add, and only then generates.
3. **Competition.** The relevance filter ranks the memory outputs against
   working memory; the attention gate trims to the top-K survivors.
4. **Selection.** The distiller selects the best surviving response, without
   rewriting it, as the single new broadcast — the "conscious" thought for the
   next epoch.
5. **Memory & lifecycle.** Working memory rolls forward, oversized nodes split,
   and underperforming nodes are pruned.

### Afferent context is never filtered

Tool and sensor output flows to **every** memory node as context, but it never
competes for the spotlight — only memory outputs do. This keeps a single
bottleneck, consistent with GWT, and is deliberate: a memory node that engages
with afferent input updates its own context even when its response doesn't win
the broadcast. The "subconscious" still did work. Memory nodes see the prompt
prefix `[identity + accumulated context][working memory][afferent context][broadcast]`,
ordered so the large, stable prefix stays cache-friendly.

## Nodes

All nodes implement a common `Node` interface (`src/types/node.ts`): an `id`, a
`kind`, accumulated `context`, and a `sendMessage` that returns a response or
nothing.

- **MemoryNode** (`src/node/memory-node.ts`) — the cognitive unit. Holds a
  specialized body of experience, decides relevance, generates, and appends each
  exchange to its own growing context.
- **ToolNode** (`src/node/tool-node.ts`) — afferent. Invokes external tools over
  the [Model Context Protocol](https://modelcontextprotocol.io/); raw results
  become afferent context.
- **SensoryNode** (`src/node/sensory-node.ts`) — afferent. Pulls in external
  observations through a `Sensor` (e.g. the bundled Wikipedia sensor).

### Growth: splitting

When a memory node's context exceeds `contextLengthThreshold`, a `NodeSplitter`
divides it by topic into two coherent specialists, each inheriting half the
parent's experience. The collective grows new expertise under load.

### Decay: pruning

Left unchecked, splitting and bootstrapping only ever _add_ nodes. The
orchestrator accumulates per-node statistics (`epochsAlive`, `epochsSpoken`,
`epochsFiltered`) and a `NodePruner` removes dead weight:

- Nodes are eligible only after a `minEpochsAlive` grace period (so freshly
  spawned or split nodes aren't culled before they can contribute).
- An eligible node is pruned if it spoke in fewer than `minBroadcasts` epochs
  (inert) or was filtered out in more than `maxFilterRate` of the epochs it
  spoke (low-signal).
- A `minMemoryNodes` floor is always honoured; when more nodes qualify than the
  floor allows, the worst performers go first.

### Bootstrapping

If no memory node survives an epoch, the orchestrator spawns a fresh MemoryNode
seeded with current working memory — the collective regrows a perspective rather
than falling silent.

## Provider abstraction

All model interaction goes through the `Provider` interface
(`src/types/provider.ts`), so the cognitive machinery is decoupled from any
specific API:

- `generate` — chat completion from a system prompt and messages
- `selectBest` — selects one candidate by a supplied set of criteria
- `rankByRelevance` — orders items against a concept (the filter's engine)
- `askYesNoQuestion` — a node's relevance gate
- `splitString` — semantic bisection for node splitting
- `generateWithTools` — tool-calling for ToolNodes

`OpenaiProvider` implements it against the OpenAI SDK, wrapped by
`QueuingOpenAi`, which adds bounded concurrency, retries, and request timeouts —
important when many nodes hit a single local model at once.

## Setup

```bash
npm install            # install dependencies
cp settings.example.ts settings.ts   # then edit to taste (the build does this for you)
```

`settings.ts` configures the model endpoint (defaults to a local LM Studio
server), MCP tool servers, working-memory size, and the split/prune thresholds.
See `settings.example.ts` for the full list.

## Development

```bash
npm test           # run the suite with coverage (100% thresholds enforced)
npm run build      # compile TypeScript to dist/
npm run lint       # ESLint + Prettier check
npm run format     # auto-fix
npm run release    # clean install, lint, build, test
```

Run a single test file with `npx vitest src/node/memory-node.test.ts`.

### Conventions

- **No `any`.** Specific types or generics only.
- **Descriptive errors** over generic ones.
- **100% coverage** is enforced, but coverage is a floor, not the goal — tests
  assert behaviour, not just lines.

## Project status

The cognitive core is complete and exercised end to end: nodes, working memory,
the two-wave epoch, relevance filtering, distillation, splitting, pruning,
MCP tool calling, sensory input, and session persistence.

Tool calling is single-phase — results are broadcast raw and synthesized
globally by the distiller rather than by the calling node, so a dedicated
second tool-synthesis pass is intentionally unnecessary. A terminal UI for
visualizing node activity in real time is the main planned addition.

## License

MIT
