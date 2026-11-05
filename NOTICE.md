# Notices

Pixel Agent Workspace is built on third-party open-source work. This file records where code, ideas and assets come from.

## Pixel Agents

- Source: https://github.com/pixel-agents-hq/pixel-agents (imported with full git history, v1.5.0)
- Code licence: MIT, Copyright (c) 2026 Pablo De Lucca — see [LICENSE](LICENSE).
- Characters: upstream's sheets were based on [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) (third-party terms). Pixel Agent Workspace has **replaced** `webview-ui/public/assets/characters/char_*.png` with original characters drawn in code (`scripts/paw-art/generate-characters.mjs`). The old sheets remain only in git history.
- Pets (`assets/pets/claudio`, `assets/pets/gitcat`) are upstream's; the default office uses them as its cats.
- Furniture, floors and walls: introduced as open-source replacements in upstream PR #117. Per-file licences still have to be confirmed before a public release.

## Pixel Agent Workspace original art

- The six characters in `webview-ui/public/assets/characters/` (`scripts/paw-art/generate-characters.mjs`).
- Everything under `webview-ui/public/assets/furniture/PAW_*` (day and night city windows, neon sign, neon cat, dual monitors, desk and floor lamps, lanterns, bean bag, coffee machine, fridge, kitchen counter) is drawn pixel by pixel in code by `scripts/paw-art/generate-art.mjs`. No third-party art is used. It is released under this repository's licence.
- `default-layout-2.json` (night variant of upstream's layout, `build-night-layout.mjs`) and `default-layout-3.json` (the reference-style office, `build-reference-layout.mjs`; the server loads the highest number).

## Claude-Office (ideas only)

- Source: https://github.com/W17ant/Claude-Office (MIT).
- Only ideas are used (coffee breaks and naps, day/night, inspector card, permission card, a task-list whiteboard). They are reimplemented independently; no code or art is copied.
- Its Dunder Mifflin skin is excluded from its MIT grant and is not used in any form.

## Claude Office Visualizer (ideas only)

- Source: https://github.com/paulrobello/claude-office (MIT).
- Ideas only (context fill shown as an office object, compaction animation). No code or art is copied.
