# Pixel Agent Workspace — project rules

Pixel Agent Workspace is a local web app that shows **real** AI coding agents (Claude Code first, then Codex) as characters in a living pixel-art office. It is built on an import of [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) with full history; `/CLAUDE.md` and `/CONTEXT.md` are upstream's architecture reference and glossary — read them, use their vocabulary, and keep them upstream-clean.

The approved plan is in `docs/PLAN.md`.

## Non-negotiables

- **Observation first.** The office must work with agents started anywhere (terminal, IDE, desktop app). Nothing requires launching through the site.
- **Never invent agent data.** Tasks, roles, tools, sub-agents, tokens and statuses come only from real events. Missing data shows `Unknown` / `Unavailable`. Synthetic data exists only in an explicitly badged Demo Mode; history only in a badged Replay Mode.
- **Leisure is not work.** Characters may idle, drink coffee, chat, etc. only while their agent is confirmed `idle` / `waiting_user`; the UI always shows the real status. No AI calls for game behaviour.
- **Interaction is opt-in.** Control (launch, terminal, messages, Allow/Deny) stays hidden behind menus, needs the server token, and never enables skip-permissions by default.
- **Local and private.** Bind `127.0.0.1`. No telemetry, no cloud, no paid APIs. Mask secrets before anything reaches the browser or history files.
- **Hooks only with consent.** Any write to `~/.claude/` or `~/.codex/` goes through the consent gate, with backup and uninstall.

## Working with upstream

- Remotes: `upstream` = pixel-agents-hq/pixel-agents, `origin` = TallibDev/pixel-agent-workspace.
- Put new features in new files/modules (`server/src/providers/<source>/`, `server/src/history/`, `webview-ui/src/office/life/`, our asset pack). Keep edits to upstream files small and surgical so `git merge upstream/main` stays cheap.
- Keep upstream `LICENSE`; record third-party code, ideas and assets in `NOTICE.md`.
- Do not reuse upstream's character sprites (third-party JIK-A-4 pack) or anything from Claude-Office's Dunder Mifflin skin. New art is original.

## Where our code lives

- `server/src/observation/` — observation tracker (honest per-agent model + feed), secret masking, transcript meta, history journal (`~/.pixel-agent-workspace/history/`, 14 days), `service.ts` wiring + history requests.
- `server/src/providers/codex/` — read-only Codex observer (rollout parser + watcher → office agents with `providerId: 'codex'`). Never write under `~/.codex`. Limits in `docs/CODEX.md`.
- `webview-ui/src/observation/` — HUD: summary bar, agent card, activity feed, hooks wizard, history, Replay.
- `webview-ui/src/i18n/` — RU/EN dictionaries (`strings.ts`; ru must mirror en keys), `t`/`useT`, tool-status translation.
- `webview-ui/src/office/life/` — `leisure.ts` (free time only when the agent is not active), `lighting.ts` (day/night pass, Canvas 2D), `timeOfDay.ts` (Day/Night/Auto mode, `paw.timeMode`, eased `nightness`, day sprite variants).
- `webview-ui/src/workspace/` — desktop shell from the design reference: `Sidebar` (nav + upstream toolbar in its footer), `TopBar` (clock, sun/moon/auto, bell, language), `RightPanels` (agents, current tasks, recent activity), `AgentStrip` (bottom cards). Shared panel state in `uiStore.ts`. Mobile keeps upstream's shell.
- Never show invented progress: "Current tasks" uses an indeterminate bar because agents report no percentages.
- Art: `scripts/paw-art/generate-art.mjs` → `PAW_*` furniture; `generate-characters.mjs` → `characters/char_*.png`; `build-reference-layout.mjs` → `default-layout-3.json` (current default). Regenerate, don't hand-edit the PNGs.
- Colours in TS must live in `webview-ui/src/constants.ts` (upstream lint rule).

## Commands (Node 22, see `.nvmrc`)

```bash
npm ci                 # install
npm run build          # extension + standalone + webview → dist/
npm run check-types
npm run lint
npm test               # webview + server + package contract
node dist/cli.js --port 3100 --no-terminal   # standalone, observe only
```

`.claude/launch.json` has the `standalone-observe` preview config.

## Testing rules

- Server tests must never touch the real home: `server/__tests__/setup/isolateHome.ts` sandboxes `HOME`/`USERPROFILE`. Any new test that needs a home directory uses a temp dir.
- Known Windows-only baseline failures (6, upstream test assumptions): `cli.test.ts` hook path escaping, `server.test.ts` file mode `0600`, `mockClaudeRunner.test.ts` timeouts. Don't mask them; fix or track them.
- Adapters get fixture-based tests from sanitized real transcripts and a documented limitations list.

## Git

Commit or push only when the user explicitly allows it. Work on feature branches, not `main`.
