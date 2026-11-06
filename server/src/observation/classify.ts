/**
 * Maps a tool name to the kind of work it represents. The office uses this to
 * pick a zone and animation; the agent card uses it as a label. Unknown tools
 * map to 'other' — never guessed into a more specific category.
 */
import type { ObservedActivity } from '../../../core/src/messages.js';

export type { ObservedActivity };

const BY_TOOL: Record<string, ObservedActivity> = {
  Read: 'reading',
  NotebookRead: 'reading',
  LS: 'reading',
  Grep: 'searching',
  Glob: 'searching',
  ToolSearch: 'searching',
  Edit: 'writing',
  MultiEdit: 'writing',
  Write: 'writing',
  NotebookEdit: 'writing',
  Bash: 'running',
  PowerShell: 'running',
  BashOutput: 'running',
  KillShell: 'running',
  WebFetch: 'browsing',
  WebSearch: 'browsing',
  Task: 'delegating',
  Agent: 'delegating',
  SendMessage: 'delegating',
  TeamCreate: 'delegating',
  TodoWrite: 'planning',
  TaskCreate: 'planning',
  TaskUpdate: 'planning',
  EnterPlanMode: 'planning',
  ExitPlanMode: 'planning',
  AskUserQuestion: 'asking',
  // Codex
  exec: 'running',
  apply_patch: 'writing',
  spawn_agent: 'delegating',
  send_message: 'delegating',
  request_user_input_async: 'asking',
  request_user_input: 'asking',
};

export function classifyTool(toolName: string | undefined): ObservedActivity {
  if (!toolName) return 'other';
  const direct = BY_TOOL[toolName];
  if (direct) return direct;
  // MCP tools: mcp__<server>__<tool>. Read-ish verbs only; everything else stays 'other'.
  if (toolName.startsWith('mcp__')) {
    const tool = toolName.split('__').pop()?.toLowerCase() ?? '';
    if (/^(read|get|list|search|find|fetch|query)/.test(tool)) return 'reading';
  }
  return 'other';
}
