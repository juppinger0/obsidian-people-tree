# Changelog

All notable changes to People Tree are documented here.

---

## [1.0.2] — 2026-06-27

### Fixed
- `activeDocument` was imported as a named module export which esbuild resolves to `undefined` at runtime — changed to a global `declare const` declaration
- `revealLeaf` removed from `activateView()` (flagged by `no-unsupported-api` linter for minAppVersion 1.7.0)
- Settings heading no longer contains the plugin name (Obsidian style guide)

---

## [1.0.1] — 2026-06-27

### Fixed
- Timeline direction button (⇕ / ⇔) visually merged with PNG export button — added `width: auto`, padding and `border-left` separator to `.ft-tl-dir-btn`
- Removed all `!important` declarations from `styles.css`
- `vault.delete()` replaced with `fileManager.trashFile()` for safe deletion
- All `document.*` calls replaced with `activeDocument.*` for multi-window support
- All `setTimeout` calls replaced with `window.setTimeout`
- Direct `.style` assignments replaced with `setCssStyles({})`
- Static inline styles moved to CSS utility classes

---

## [1.0.0] — 2026-06-27

### Initial Release

- 4 view modes: Tree 🌳, Org Chart 🏢, Timeline 📅 (horizontal + vertical), List 📋
- Drag cards freely — positions saved automatically to `data.json`
- Drag notes from Obsidian file explorer onto the canvas
- Inline editing — changes written directly to YAML frontmatter
- File rename when editing the name field
- Avatars / photos via drag & drop or native file picker
- Add arbitrary custom fields per person
- Selection highlighting with dimming of unrelated nodes
- Remove from tree vs. permanent delete (with confirmation dialog)
- "Create sample family" button for instant demo
- File explorer icons (👤) for person notes
- Zoom & pan, PNG export
- Configurable photos folder and person notes folder
- Fully non-destructive — never overwrites existing notes
