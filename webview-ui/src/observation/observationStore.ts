import type {
  ActivityEntry,
  AgentObservation,
  ObservedStatus,
  ServerMessage,
} from '../../../core/src/messages.js';

/**
 * Client mirror of the server's observation model. A tiny external store
 * (useSyncExternalStore-friendly) fed by `observationSnapshot`,
 * `agentObservation`, `agentObservationRemoved` and `activityEvent`.
 * Holds only what the server reported — never derives or guesses fields.
 */

export const FEED_LIMIT = 300;

export interface ObservationState {
  agents: ReadonlyMap<number, AgentObservation>;
  feed: readonly ActivityEntry[];
  /** True once a snapshot arrived (before that, counts are "not yet known"). */
  synced: boolean;
}

export interface StatusCounts {
  detected: number;
  working: number;
  waiting: number;
  idle: number;
  unknown: number;
}

export class ObservationStore {
  private state: ObservationState = { agents: new Map(), feed: [], synced: false };
  private readonly listeners = new Set<() => void>();

  getState = (): ObservationState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Returns true when the message belonged to the observation model. */
  handle(msg: ServerMessage): boolean {
    switch (msg.type) {
      case 'observationSnapshot': {
        const agents = new Map<number, AgentObservation>();
        for (const a of msg.agents) agents.set(a.id, a);
        this.set({ agents, feed: msg.activity.slice(-FEED_LIMIT), synced: true });
        return true;
      }
      case 'agentObservation': {
        const agents = new Map(this.state.agents);
        agents.set(msg.agent.id, msg.agent);
        this.set({ ...this.state, agents });
        return true;
      }
      case 'agentObservationRemoved': {
        if (!this.state.agents.has(msg.id)) return true;
        const agents = new Map(this.state.agents);
        agents.delete(msg.id);
        this.set({ ...this.state, agents });
        return true;
      }
      case 'activityEvent': {
        const last = this.state.feed[this.state.feed.length - 1];
        // Snapshot and live stream can overlap on reconnect: seq is monotonic per server.
        if (last && msg.entry.seq <= last.seq) return true;
        const feed = [...this.state.feed, msg.entry];
        if (feed.length > FEED_LIMIT) feed.splice(0, feed.length - FEED_LIMIT);
        this.set({ ...this.state, feed });
        return true;
      }
      default:
        return false;
    }
  }

  private set(next: ObservationState): void {
    this.state = next;
    for (const l of this.listeners) l();
  }
}

export function countStatuses(agents: Iterable<AgentObservation>): StatusCounts {
  const c: StatusCounts = { detected: 0, working: 0, waiting: 0, idle: 0, unknown: 0 };
  for (const a of agents) {
    c.detected++;
    c[bucketOf(a.status)]++;
  }
  return c;
}

export function bucketOf(status: ObservedStatus): Exclude<keyof StatusCounts, 'detected'> {
  switch (status) {
    case 'working':
      return 'working';
    case 'waiting_permission':
    case 'waiting_user':
      return 'waiting';
    case 'idle':
      return 'idle';
    default:
      return 'unknown';
  }
}

/** Display name from what the source told us; never an invented persona. */
export function agentLabel(
  a: Pick<AgentObservation, 'id' | 'agentName' | 'project'>,
  fallback: (id: number) => string = (id) => `Agent #${id}`,
): string {
  return a.agentName ?? a.project ?? fallback(a.id);
}
