# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static site (vanilla HTML/CSS/JS, no build step, no framework, no npm dependencies at runtime) that displays a daily briefing on the French/European startup, VC, AI, tech and macro ecosystem, plus a "Deals" tracker tab. Two independent editorial sources feed the briefing side: "Web & Tendances" (`data/*.md`, produced by Gumloop) and "Newsletters" (`data/newsletters/*.md`, produced by a separate Python script). Deployed on GitHub Pages by serving `main` from the repo root.

## Commands

```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000`. A local server is required — the page loads `data/*.md`, `data/newsletters/*.md`, `data/index.json`, `data/newsletters/index.json` and `data/deals.json` via `fetch`, which fails when opening `index.html` directly (`file://`).

```bash
node scripts/generate-index.js
```
Regenerates **both** `data/index.json` and `data/newsletters/index.json` (same `{ generatedAt, dates }` shape), each from whatever `YYYY-MM-DD.md` files exist in its own directory. Runs automatically in CI (`.github/workflows/update-index.yml`) on every push touching `data/*.md` or `data/newsletters/*.md` — it commits both regenerated indexes back to `main` as `github-actions[bot]`. No manual run needed after adding a dated briefing, but useful to preview locally.

There is no build, lint, or test tooling in this repo — no `package.json`, no bundler, no test runner. Verify changes by serving locally and checking the page in a browser (or Playwright, if available, for automated screenshots).

## Architecture

Three files do all the work: `index.html` (structure/shell only), `css/styles.css` (design system), `js/app.js` (an IIFE, no modules, no build — everything is one script tag loaded with `defer`, plus `marked` from a CDN for Markdown parsing).

### Views and sources, one page, hash-routed

`js/app.js` toggles between top-level views (`home` / `briefing` / `deals`) by setting `document.body.dataset.view` and showing/hiding `#homeView`, `#briefingLayout`, `#dealsView` (see `setView()`). Orthogonal to the view is the active **content source** — `state.activeSource`, either `"web"` or `"newsletters"` — selected via the `#tabSourceWeb` / `#tabSourceNewsletters` tabs (`switchSource()`). Each source keeps its own independent `{ dates, cache, currentDate }` under `state.bySource.web` / `state.bySource.newsletters`; the `SOURCES` config object maps each key to its `dir` (`data` or `data/newsletters`) and hash prefix. The sidebar archives, the home page, and `goToCategory`/`goToSection` all read/write the *active* source only — switching tabs never mixes the two archives.

Routing is via `location.hash` (parsed by `parseHash()`):
- `""` / `#home` → Web & Tendances home.
- `#newsletters` → Newsletters home.
- `#YYYY-MM-DD` → Web & Tendances briefing for that date (kept unprefixed for backward-compatible links to pre-existing URLs).
- `#newsletters/YYYY-MM-DD` → Newsletters briefing for that date.
- `#deals` → deals view.

**CSS trap to know about**: any element toggled with the `hidden` attribute that also has an author `display` rule on the same selector needs an explicit `selector[hidden] { display: none; }` override — the UA `[hidden]` stylesheet rule loses to an equal-or-higher-specificity author rule. `.layout[hidden]` and `.deals-toolbar[hidden]` exist for exactly this reason; if you add a new toggled container with `display: flex/grid`, add the same override or it will silently stay visible.

### Briefing view: Markdown → structured DOM

Daily briefings live in `data/YYYY-MM-DD.md` (Web & Tendances) and `data/newsletters/YYYY-MM-DD.md` (Newsletters) — both sources follow the exact same editorial convention and are rendered through the same `parseBriefing`/`classifySection`/`CATEGORY_RULES` pipeline (see `data/2026-07-09.md`, `data/2026-07-10.md`):
- One H1 title (may start with an emoji) and an optional H3 subtitle before the first `##`.
- Content is split into H2 (`##`) sections. `splitMarkdown()` in `app.js` cuts the raw markdown on H2 boundaries; each section's body is handed to `marked.parse()`.
- `classifySection(headingText)` pattern-matches each H2 heading's text (French, case-insensitive) to decide how to render it:
  - `avertissement` → warning banner
  - `résumé exécutif` → hero summary block
  - `contexte de fond` → muted/dashed "context" card
  - otherwise matched against `CATEGORY_RULES` (regexes for `france`, `venture capital|financement`, `intelligence artificielle`, `tech europe|monde`, `macro|économie`) → a colored category card, or a plain card if nothing matches.
- A leading emoji on any heading (`EMOJI_RE`) is extracted and used as the card/section icon; the rest becomes the visible title.
- Nested subheadings inside a section's own markdown body (e.g. H3s inside "Contexte de fond") are rendered by `marked` as real `<h2>/<h3>/<h4>` and styled directly in `.card-body h2/h3/h4` in CSS — this is intentional, not a fallback.

When adding a new category or changing how a section is classified, edit `CATEGORY_RULES` / `classifySection()`; the category's color comes from `--cat-<key>` CSS custom properties and `.card[data-cat="<key>"]`.

The sidebar (`#sidebar`) lists dates for the **active source only** (from `data/index.json` or `data/newsletters/index.json`), grouped by month (`buildSidebarArchives()`, rebuilt on tab switch). Full-text search is **global across both sources**: a debounced search fetches and caches every `data/*.md` and `data/newsletters/*.md` file (`state.bySource.<key>.cache`) and searches stripped plain text client-side — there is no search index or server. Results are tagged with their source label and sorted by date; clicking a result from the inactive source switches tabs (`switchSource()`) before loading it.

### Deals view: filterable/sortable table over `data/deals.json`

`data/deals.json` is an array of objects with fields `date, societe, type, secteur, montant_meur, serie, investisseurs (array), pays`. It may be absent, empty, or malformed — `fetchDeals()` treats all of these as non-fatal (`reason: "missing"|"invalid"|"empty"|"error"`) and the UI shows a friendly empty state (`DEALS_EMPTY_MESSAGES`) instead of erroring. The file does not need to exist for the rest of the site to work.

Key points if extending this view:
- Stats (`computeDealStats`) are always a fixed rolling-30-day window from `new Date()`, independent of the table's filters — the table's secteur/pays/type/montant filters (`state.dealsFilters`) only scope the table, not the stat tiles. Keep it that way; don't wire filters into the stats without also rethinking the "30 derniers jours" framing.
- `secteur`/`pays`/`type`/`serie` are rendered as neutral outlined chips (`.chip`), not color-coded — the value set is open-ended/unbounded (unlike the briefing's 5 fixed categories), so there's no fixed hue mapping to assign safely.
- Table sort/filter state lives in `state.dealsSort` / `state.dealsFilters`; `renderDealsTableView()` is the single re-render entry point after any change.
- Untrusted/data-driven strings (company names, investors, sector labels) are inserted via `textContent`, never `innerHTML` string concatenation, since they come from a JSON file that could contain arbitrary text.
- Deals data is fetched lazily on first switch to the tab (`ensureDealsLoaded()`, guarded by `state.dealsLoadState`) and cached for the session — switching tabs afterward doesn't refetch.

### Design system

- Fonts: Fraunces (serif, headings) + Inter (sans, everything else), loaded from Google Fonts in `index.html`.
- Colors: CSS custom properties in `:root` (light) and `:root[data-theme="dark"]` / a `prefers-color-scheme: dark` media query mirror (both must be kept in sync — theme is user-toggleable via `js/app.js` `toggleTheme()`, stored in `localStorage` under `veille-theme`, and independently falls back to OS preference).
- The 5 briefing categories (france/vc/ia/tech/macro) have fixed hex colors per mode (`--cat-*`) — do not reassign or reorder these; do not invent a 6th without picking a color that's been checked for contrast/colorblind-safety in both light and dark.
- `--ink-muted` is deliberately darker than it looks like it "should" be (`#6b6555` light / `#948d78` dark) — it was tuned to clear 4.5:1 contrast against `--page`; don't lighten it back without re-checking contrast.
- Spacing/sizing follows the values already in use per component rather than a fixed token scale — match nearby CSS when adding new components.
