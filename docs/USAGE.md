# Pixel Agent Workspace — running it and connecting agents

## Start

```bash
npm ci
npm run build
node dist/cli.js --port 3100 --no-terminal     # observe only
```

Open the URL the server prints (it carries `?token=…`). Without the token the office is view-only: you can watch, but not rename agents, install hooks or read history.

## Who is who

The office keeps four things apart:

| Entity       | What it is                                                 | Where it shows                                             |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------- |
| **Agent**    | the character: its display name and, if reported, its role | name on the character, the bottom cards, the card title    |
| **Platform** | Claude Code or Codex                                       | agent card → Platform; filter                              |
| **Project**  | the working folder the session runs in                     | agent card → Project, the line under the character; filter |
| **Session**  | one real session, with its own id and history              | agent card → Session (`Codex #2 · 01a1ac0c`)               |

The display name is, in order: the name **you** gave it, a role the source reported (a named teammate or sub-agent), else the neutral session label `Claude #1` / `Codex #2`. The project is never used as the name. Session numbers are per platform and stay the same across restarts and reconnects.

**Rename:** open the agent card (click the character or its bottom card) → ✎ → type a name → Save. An empty name restores the default. Names live in `~/.pixel-agent-workspace/agents.json`; ids and history are untouched.

**Filter:** when there is more than one platform or project, the bottom strip shows Platform and Project menus. Filtering hides the other characters in the office too; the choice is remembered in this browser.

## Statuses

| Status           | Comes from                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Working          | a running turn / tool call                                                                              |
| Needs permission | Claude Code permission request (hooks or the transcript heuristic). Not available for Codex.            |
| Waiting for you  | Claude Code idle prompt, or a "request user input" tool                                                 |
| Completed        | the turn just finished; becomes **Idle** after 3 minutes without a new turn                             |
| Idle             | connected, no task running                                                                              |
| Error            | the source reported a failed turn (Codex `task_complete.error`)                                         |
| Disconnected     | the session file vanished, a "working" session went silent for 30 minutes, or this page lost the server |
| Unknown          | not enough information yet (e.g. right after the server restarted)                                      |

## Codex

Nothing to install: start Codex Desktop or the Codex CLI and work as usual. Sessions written to in the last 10 minutes appear within ~3 seconds. Details and limits: [CODEX.md](CODEX.md).

To check it yourself:

1. Start the server and open the tokened URL.
2. In Codex (Desktop or CLI), start a task in any project.
3. Expect a character named `Codex #N` with Platform "Codex" and the right Project; it shows **Working** with the command it runs, then **Completed**.
4. Run two Codex tasks in different projects at once: two characters, two different session numbers.
5. Stop the Pixel Agent Workspace server and start it again: the characters come back under the same `Codex #N` names.
6. Open **History**: the sessions are listed with their names and can be replayed.
