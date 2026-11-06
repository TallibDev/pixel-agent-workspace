/**
 * Codex rollout parser (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl).
 *
 * Pure: one JSONL line in, zero or more normalized Codex events out. The format
 * is internal to Codex and changes between versions, so every field is read
 * defensively and unknown records are ignored. Observed with Codex Desktop
 * 0.166 (record types: session_meta, turn_context, event_msg task_started /
 * task_complete / turn_aborted / token_count, response_item function_call /
 * custom_tool_call and their *_output).
 */

export type CodexEvent =
  | {
      kind: 'meta';
      threadId: string;
      cwd: string | null;
      cliVersion: string | null;
      originator: string | null;
      /** Sub-agent sessions name their kind ('guardian' = approval reviewer). */
      subagentKind: string | null;
      parentThreadId: string | null;
      nickname: string | null;
      branch: string | null;
    }
  | { kind: 'model'; model: string }
  | { kind: 'turnStart' }
  | { kind: 'turnEnd'; aborted: boolean; error?: string | null; reason?: string | null }
  | { kind: 'toolStart'; callId: string; toolName: string; status: string }
  | { kind: 'toolEnd'; callId: string }
  | { kind: 'tokens'; contextTokens: number; window: number | null };

const STATUS_MAX = 80;

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function clip(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > STATUS_MAX ? one.slice(0, STATUS_MAX) + '…' : one;
}

/**
 * Human status line for a Codex tool call, in the same shapes the Claude
 * provider uses ("Running: …", "Using …") so the UI translates them alike.
 */
export function formatCodexToolStatus(
  name: string,
  input: string,
  namespace: string | null,
): string {
  if (name === 'exec') {
    // `exec` runs a JS snippet that calls tools.<name>({...}). Prefer the shell command.
    const cmd = /cmd\s*:\s*["'`]((?:\\.|[^"'`\\])*)["'`]/.exec(input)?.[1];
    if (cmd) return `Running: ${clip(cmd.replace(/\\(.)/g, '$1'))}`;
    const tool = /tools\.(\w+)\s*\(/.exec(input)?.[1];
    if (tool === 'apply_patch') return 'Editing files';
    if (tool) return `Using ${tool}`;
    return 'Running code';
  }
  if (name === 'spawn_agent') {
    try {
      const args = JSON.parse(input) as Record<string, unknown>;
      const task = str(args.task_name);
      if (task) return `Subtask: ${clip(task)}`;
    } catch {
      /* fall through */
    }
    return 'Running subtask';
  }
  if (name === 'send_message') return 'Sending message';
  if (name === 'wait') return 'Waiting for sub-agents';
  if (name === 'request_user_input_async' || name === 'request_user_input') {
    return 'Waiting for your answer';
  }
  if (namespace && namespace.startsWith('mcp__')) return `Using ${namespace}__${name}`;
  return `Using ${name}`;
}

/** Tool name as the office classifies it (classify.ts / reading-vs-typing). */
export function codexToolName(name: string, input: string, namespace: string | null): string {
  if (name === 'exec') {
    if (/tools\.apply_patch\s*\(/.test(input)) return 'apply_patch';
    return 'exec';
  }
  if (namespace && namespace.startsWith('mcp__')) return `${namespace}__${name}`;
  return name;
}

export function parseRolloutLine(line: string): CodexEvent[] {
  if (!line.trim()) return [];
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  const type = rec.type;
  const p = (rec.payload && typeof rec.payload === 'object' ? rec.payload : {}) as Record<
    string,
    unknown
  >;

  if (type === 'session_meta') {
    const source = p.source as Record<string, unknown> | string | undefined;
    const sub =
      source && typeof source === 'object'
        ? ((source.subagent as Record<string, unknown> | undefined) ?? null)
        : null;
    let subagentKind: string | null = null;
    if (sub) {
      subagentKind =
        str((sub as Record<string, unknown>).other) ?? Object.keys(sub)[0] ?? 'subagent';
    }
    const git = (p.git && typeof p.git === 'object' ? p.git : {}) as Record<string, unknown>;
    const threadId = str(p.id) ?? str(p.session_id);
    if (!threadId) return [];
    return [
      {
        kind: 'meta',
        threadId,
        cwd: str(p.cwd),
        cliVersion: str(p.cli_version),
        originator: str(p.originator),
        subagentKind,
        parentThreadId: str(p.parent_thread_id) ?? str(p.forked_from_id),
        nickname: str(p.agent_nickname),
        branch: str(git.branch),
      },
    ];
  }

  if (type === 'turn_context') {
    const model = str(p.model);
    return model ? [{ kind: 'model', model }] : [];
  }

  if (type === 'event_msg') {
    switch (p.type) {
      case 'task_started':
        return [{ kind: 'turnStart' }];
      case 'task_complete': {
        const err = p.error as Record<string, unknown> | string | null | undefined;
        const error =
          typeof err === 'string'
            ? err
            : err && typeof err === 'object'
              ? (str(err.message) ?? 'Error')
              : null;
        return [
          error ? { kind: 'turnEnd', aborted: false, error } : { kind: 'turnEnd', aborted: false },
        ];
      }
      case 'turn_aborted':
        return [{ kind: 'turnEnd', aborted: true, reason: str(p.reason) }];
      case 'token_count': {
        const info = p.info as Record<string, unknown> | null | undefined;
        if (!info) return [];
        const last = info.last_token_usage as Record<string, unknown> | undefined;
        const input = typeof last?.input_tokens === 'number' ? last.input_tokens : 0;
        const output = typeof last?.output_tokens === 'number' ? last.output_tokens : 0;
        if (input + output <= 0) return []; // all-zero usage is "no news"
        const window =
          typeof info.model_context_window === 'number' ? info.model_context_window : null;
        return [{ kind: 'tokens', contextTokens: input + output, window }];
      }
      default:
        return [];
    }
  }

  if (type === 'response_item') {
    const callId = str(p.call_id);
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const name = str(p.name);
      if (!callId || !name) return [];
      const input = str(p.input) ?? str(p.arguments) ?? '';
      const ns = str(p.namespace);
      return [
        {
          kind: 'toolStart',
          callId,
          toolName: codexToolName(name, input, ns),
          status: formatCodexToolStatus(name, input, ns),
        },
      ];
    }
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      return callId ? [{ kind: 'toolEnd', callId }] : [];
    }
  }
  return [];
}
