# Codex support

Pixel Agent Workspace observes OpenAI Codex (CLI and Codex Desktop) **read-only**, from the rollout files Codex writes for every session:

```
~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl   (or $CODEX_HOME/sessions)
```

Nothing under `~/.codex` is written: no hooks are installed, `config.toml` and its `notify` entry are left alone. If the folder does not exist, the observer stays off.

Code: `server/src/providers/codex/` — `rolloutParser.ts` (pure, one line → events) and `codexObserver.ts` (discovery, tailing, office agents). Tests: `server/__tests__/codexObserver.test.ts`, on synthetic records shaped like Codex Desktop 0.166 rollouts.

## What is shown

| In the office          | From the rollout                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An agent appears       | a rollout written to in the last 10 minutes (any of the last 14 day folders — resumed sessions keep their original folder)                                           |
| Project, branch, model | `session_meta.cwd`, `session_meta.git.branch`, `turn_context.model`                                                                                                  |
| Working                | `event_msg task_started` … until `task_complete` / `turn_aborted`                                                                                                    |
| Current action         | `custom_tool_call` / `function_call` — `exec` shows the shell command (`Running: npm test`), `apply_patch` as editing, `spawn_agent` as a subtask, MCP tools by name |
| Idle (turn finished)   | `task_complete`                                                                                                                                                      |
| Context gauge          | `event_msg token_count` → `last_token_usage` (input + output) against `model_context_window`                                                                         |
| Delegated sub-agent    | a sub-session with `parent_thread_id` → its own character, seated as a teammate of the session that spawned it                                                       |

Codex agents carry `source: codex` everywhere: the agent card says "Codex", the feed and history record them like Claude agents, and secrets in commands are masked the same way.

## Limitations (honest list)

- **No "needs permission".** Rollouts carry no approval-request record, so a Codex agent waiting for your approval looks like it is still working on its current command. This would need Codex hooks (`PermissionRequest`), which require trusting a hook in Codex (`/hooks`) — not done without your consent.
- **No "waiting for you" vs "finished".** Both read as idle after `task_complete`.
- **No session end.** Codex writes no end record; an agent leaves the office after 30 minutes without writes.
- **Guardian sub-sessions are hidden.** They are Codex's internal approval reviewers, not work you delegated.
- **The format is internal to Codex** and may change between versions. Unknown records are ignored; tested against Codex Desktop 0.166.
- **Codex cloud tasks** produce no local rollout and are not shown.
