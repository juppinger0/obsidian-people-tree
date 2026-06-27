# People Tree — Obsidian Plugin

An interactive family tree, org chart and timeline viewer for [Obsidian](https://obsidian.md). All data lives in your vault as plain Markdown notes with YAML frontmatter — no external services, no proprietary formats.

---

## Features

- **4 view modes** — Tree (smooth curves), Org Chart (right-angle connectors), Timeline (birth-year axis), List (searchable, sortable table)
- **Avatars / photos** — upload an image or point to any file already in your vault
- **Inline editing** — edit any field directly in the view; changes are written back to the note's frontmatter immediately
- **Add fields** — add arbitrary custom fields to a person without leaving the plugin
- **Selection highlighting** — click a node to highlight it and all direct connections; everything else dims
- **Zoom & pan** — mouse wheel to zoom, drag to pan (Tree / Org Chart / Timeline)
- **Sortable list** — click any column header to sort ascending / descending

---

## Installation (manual)

Until the plugin is available in the Obsidian Community Store, install it manually:

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/juppinger0/obsidian-family-tree/releases).
2. Copy all three files into your vault under `.obsidian/plugins/people-tree/`.
3. In Obsidian: **Settings → Community plugins → enable "People Tree"**.
4. Click the 👥 icon in the left ribbon, or run **"People Tree öffnen"** from the command palette.

---

## How to add a person

Create a Markdown note anywhere in your vault with `type: person` in the frontmatter:

```yaml
---
type: person
name: Jane Doe
born: 15.03.1970
died:
avatar: 02 Areas/Familie/Fotos/jane.jpg
parents:
  - John Doe
  - Mary Doe
spouse: Bob Smith
children:
  - Alice Smith
  - Tom Smith
---
```

The plugin picks up the note automatically — no configuration needed. Names in `parents`, `spouse` and `children` must match the `name` field of the referenced person exactly.

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `type: person` | **Yes** | Marks the note as a person. Without this the note is ignored. |
| `name` | No | Display name. Defaults to the file name if omitted. |
| `born` | No | Birth date (any format). Used to place nodes on the Timeline axis. |
| `died` | No | Death date. |
| `avatar` | No | Vault-relative path to an image file (e.g. `Fotos/jane.jpg`). |
| `parents` | No | List of parent names. Draws parent → child connection lines. |
| `spouse` | No | Name of spouse/partner. Draws a dashed line between the two nodes. |
| `children` | No | List of children's names. |
| *any other field* | No | Shown in the expanded detail panel; editable inline. |

---

## View modes

Switch between modes using the toolbar buttons at the top.

### 🌳 Tree
Classic top-down family tree with smooth Bézier curves connecting parents to children.

### 🏢 Org Chart
Same layout as Tree, but connections use right-angle elbow lines — useful for hierarchical org structures.

### 📅 Timeline
Nodes are positioned horizontally by birth year. Useful for spotting generational overlaps and lifespans at a glance. Requires `born` fields with a 4-digit year.

### 📋 List
Searchable, sortable table of all persons. Click any column header to sort. Click a cell to edit the value inline.

---

## Adding photos

In **List mode**, click the **📷** button at the end of any row. A dialog appears with two options:

**Option A — Upload from your computer**
Click **"📁 Choose image file…"** to open your file browser. The image is copied into `02 Areas/Familie/Fotos/` inside your vault and the `avatar` path is written to the person's frontmatter automatically.

**Option B — Use a file already in your vault**
Type the vault-relative path into the text field (e.g. `Fotos/jane.jpg`) and click **"Save path"**.

To remove a photo, open the dialog and click **"Remove photo"**.

---

## Editing data

- **In List mode**: click any data cell (Born, Died, Parents, etc.) to edit it inline. Press `Enter` to save, `Esc` to cancel.
- **In Tree / Org Chart / Timeline**: click the **▼** button on a node to expand the detail panel. Click any field value to edit it. Use **"+ Add field"** to add a new custom frontmatter field.
- **In all modes**: changes are written directly to the note's YAML frontmatter. The view refreshes automatically when a note changes.

---

## Notes

- The plugin scans **all** Markdown files in the vault. Only notes with `type: person` in the frontmatter are included.
- Relationship lines are drawn only when names match exactly (case-sensitive).
- The Timeline mode requires at least two persons with a 4-digit year in their `born` field.
- Photos are stored as binary files in the vault and are not tracked by git unless you configure git-lfs.

---

## Known Issues / TODO

| # | Issue | Status |
|---|-------|--------|
| 1 | **Photo upload only works reliably in List mode** via the 📷 button. In Tree/Org-Chart/Timeline the modal opens but the native file picker may be blocked by Electron's security sandbox. Workaround: switch to List mode, upload there, then switch back. | open |
| 2 | Long field values (e.g. vault paths) wrap awkwardly in narrow tree nodes. Hover to reveal full text. | partially fixed |
| 3 | Timeline mode requires at least 2 persons with a 4-digit year in `born`. | by design |

---

## Development

```bash
git clone https://github.com/juppinger0/obsidian-family-tree
cd obsidian-family-tree
npm install
npm run build        # production build → main.js
```

Copy `main.js`, `manifest.json` and `styles.css` to your vault's `.obsidian/plugins/people-tree/` folder and reload the plugin.

---

## License

MIT
