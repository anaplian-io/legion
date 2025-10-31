import { Agent, AgentOutputItem, run, SystemMessageItem } from '@openai/agents';
import {
  Daemon,
  DaemonIdentity,
  DaemonResponseMessage,
  EpochMessage,
} from '../types/daemon.js';
import {
  AgentMessageTransformer,
  ContextFormatter,
  ContextProvider,
  EpochMessageTransformer,
} from '../types/context.js';

export interface OpenaiAgentDaemonProps {
  readonly identity: DaemonIdentity;
  readonly agent: Agent;
  readonly instructions: string;
  readonly contextFormatter: ContextFormatter;
  readonly contextProviders: ContextProvider[];
  readonly agentMessageTransformer: AgentMessageTransformer;
  readonly epochMessageTransformer: EpochMessageTransformer;
  readonly runFn: typeof run;
}

export class OpenAiAgentDaemon implements Daemon {
  public description: string;
  public name: string;
  private _history: AgentOutputItem[] = [];

  constructor(private readonly props: OpenaiAgentDaemonProps) {
    this.description = props.identity.description;
    this.name = props.identity.name;
  }

  get id() {
    return this.props.identity.id;
  }

  get history() {
    return this._history;
  }

  public readonly nextEpoch = async (
    globalMessageHistory: EpochMessage[],
  ): Promise<DaemonResponseMessage> => {
    const {
      agent,
      contextFormatter,
      contextProviders,
      instructions,
      runFn,
      agentMessageTransformer,
      epochMessageTransformer,
    } = this.props;
    const currentCompiledContext = await contextFormatter.format(
      this._history,
      contextProviders,
    );
    const contextMessage: SystemMessageItem = {
      content: `You are '${this.name}' (agent ID ${this.id}).\nAgent Instructions: ${instructions}\nCurrent Context: ${currentCompiledContext}`,
      role: 'system',
      type: 'message',
    };
    const agentEpochOutput = await runFn(agent, [
      contextMessage,
      ...this._history,
      ...epochMessageTransformer.transform(globalMessageHistory),
    ]);
    const transformedAgentEpochOutput = agentMessageTransformer.transform(
      agentEpochOutput.output,
    );
    this._history = [...this._history, ...transformedAgentEpochOutput];
    return {
      type: 'daemon',
      identity: {
        id: this.id,
        name: this.name,
        description: this.description,
      },
      output: agentEpochOutput.finalOutput ?? '<Agent generated no output>',
    };
  };
}
