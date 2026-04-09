# OSRS Skill Selector

This repository is the source for the GitHub Pages version of the OSRS skill selector and notes page.

It is a static browser-only page with no backend, no build step, and no external runtime dependencies. The repository exists to back the live page rather than to be distributed as a downloadable app.

## Page Features

- Skill marker tab for tracking OSRS skills directly on the skill tab image
- Notes tab with per-skill note mapping on the skill box image
- Markdown notes editor with write, preview, and split modes
- Toolbar support for headings, lists, checklists, quotes, links, inline code, code blocks, dividers, undo, and redo
- Adjustable grid placement for both tabs so overlays can be aligned locally in the browser
- Local-only data ownership with no server sync

## Local Storage Model

- Marker state, active tab, selected note skill, grid placement, and editor height are stored in `localStorage`
- Note content is stored in IndexedDB with per-skill history snapshots
- All saved data stays on the current browser origin