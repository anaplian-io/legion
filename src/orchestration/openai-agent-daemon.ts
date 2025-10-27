import {
  Agent,
  AgentOutputItem,
  run,
  SystemMessageItem,
  UserMessageItem,
} from '@openai/agents';
import { Daemon, DaemonIdentity } from '../types/daemon.js';
import {
  AgentMessagePostProcessor,
  ContextFormatter,
  ContextProvider,
} from '../types/context.js';

export interface OpenaiAgentDaemonProps {
  readonly identity: DaemonIdentity;
  readonly agent: Agent;
  readonly instructions: string;
  readonly contextFormatter: ContextFormatter;
  readonly contextProviders: ContextProvider[];
  readonly agentMessagePostProcessor: AgentMessagePostProcessor;
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

  public readonly nextEpoch = async () => {
    const {
      agent,
      contextFormatter,
      contextProviders,
      instructions,
      runFn,
      agentMessagePostProcessor,
    } = this.props;
    const currentCompiledContext = await contextFormatter.format(
      this._history,
      contextProviders,
    );
    const contextMessage: SystemMessageItem = {
      content: `You are ${this.name} (agent ID ${this.id}). Current Context: ${currentCompiledContext}`,
      role: 'system',
      type: 'message',
    };
    const instructionsMessage: UserMessageItem = {
      content: instructions,
      role: 'user',
      type: 'message',
    };
    const agentEpochOutput = await runFn(agent, [
      contextMessage,
      ...this._history,
      instructionsMessage,
    ]);
    const transformedAgentEpochOutput = agentMessagePostProcessor.transform(
      agentEpochOutput.output,
    );
    this._history = [...this._history, ...transformedAgentEpochOutput];
    return agentEpochOutput.finalOutput ?? '<Agent generated no output>';
  };
}
