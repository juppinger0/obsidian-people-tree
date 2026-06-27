# People Tree — Obsidian Plugin

An interactive family tree, org chart and timeline viewer for [Obsidian](https://obsidian.md). All data lives in your vault as plain Markdown notes with YAML frontmatter — no external services, no proprietary formats, no telemetry.

---

## Features

- **4 view modes** — Tree (smooth curves), Org Chart (right-angle connectors), Timeline (birth-year axis), List (searchable, sortable table)
- **Avatars / photos** — upload an image or point to any file already in your vault
- **Inline editing** — edit any field directly in the view; changes are written back to the note's frontmatter immediately
- **Add fields** — add arbitrary custom fields to a person without leaving the plugin
- **Selection highlighting** — click a node to highlight it and all direct connections; everything else dims
- **Zoom & pan** — mouse wheel to zoom, drag to pan (Tree / Org Chart / Timeline)
- **Sortable list** — click any column header to sort ascending / descending
- **Configurable** — set your preferred photos folder and optional person-notes folder in Settings

---

## Installation

### Community Plugin Store *(coming soon)*
Search for **"People Tree"** in Obsidian → Settings → Community plugins.

### Manual
1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/juppinger0/obsidian-family-tree/releases).
2. Copy all three files into your vault under `.obsidian/plugins/people-tree/`.
3. In Obsidian: **Settings → Community plugins → enable "People Tree"**.
4. Click the 👥 icon in the left ribbon, or run **"Open People Tree"** from the command palette.

---

## How to add a person

Create a Markdown note anywhere in your vault with `type: person` in the frontmatter:

```yaml
---
type: person
name: Jane Doe
born: 15.03.1970
died:
avatar: Attachments/Photos/jane.jpg
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
| `avatar` | No | Vault-relative path to an image file (e.g. `Attachments/Photos/jane.jpg`). |
| `parents` | No | List of parent names. Draws parent → child connection lines. |
| `spouse` | No | Name of spouse/partner. Draws a dashed line between the two nodes. |
| `children` | No | List of children's names. |
| *any other field* | No | Shown in the expanded detail panel; editable inline. |

---

## Settings

Open **Settings → People Tree**:

| Setting | Default | Description |
|---------|---------|-------------|
| Photos folder | `Attachments/Photos` | Vault-relative folder where uploaded photos are saved. |
| Person notes folder | *(empty)* | Limit person scan to this folder. Leave empty to search the whole vault. |

---

## View modes

Switch between modes using the toolbar buttons at the top.

### 🌳 Tree
Classic top-down family tree with smooth Bézier curves connecting parents to children.

### 🏢 Org Chart
Same layout as Tree, but connections use right-angle elbow lines — useful for hierarchical org structures.

### 📅 Timeline
Nodes are positioned horizontally by birth year. Useful for spotting generational overlaps and lifespans. Requires `born` fields with a 4-digit year.

### 📋 List
Searchable, sortable table of all persons. Click any column header to sort. Click a cell to edit the value inline.

---

## Adding photos

**In List mode:** click the **📷** button at the end of any row.

**In Tree / Org Chart / Timeline:** expand a node with **▼**, then click **📷** next to the "Photo" field.

A dialog opens with two options:

- **Drag & drop** an image from your file manager onto the drop zone
- **Pick a file** using the native file browser (desktop only)
- **Enter a vault path** if the image is already in your vault

The uploaded photo is saved to the configured *Photos folder* (default: `Attachments/Photos/`) and the `avatar` path is written to the frontmatter automatically.

---

## Editing data

- **In List mode**: click any data cell to edit it inline. Press `Enter` to save, `Esc` to cancel.
- **In Tree / Org Chart / Timeline**: click **▼** on a node to expand the detail panel. Click any field value to edit. Use **"+ Add field"** to add a custom frontmatter field.
- Changes are written directly to the note's YAML frontmatter and the view refreshes automatically.

---

## Known Issues / TODO

| # | Issue | Status |
|---|-------|--------|
| 1 | **Photo upload via file picker may not work in all Electron versions.** Use drag & drop in the modal as a reliable alternative. | open |
| 2 | Long field values are truncated in tree nodes (hover to reveal full text). | partial fix |
| 3 | Timeline mode requires at least 2 persons with a 4-digit year in `born`. | by design |
| 4 | No mobile-optimised touch controls for zoom/pan yet. | todo |

---

## Privacy & Security

- **No external network calls.** The plugin works fully offline.
- **No telemetry or analytics.**
- **All data stays in your vault.** Photos are copied into your vault folder; nothing is sent anywhere.
- The plugin only reads vault files and writes to frontmatter and the configured photos folder.

---

## Notes

- The plugin scans all Markdown files in the vault (or the configured folder). Only notes with `type: person` are included.
- Relationship lines are drawn only when names match exactly (case-sensitive).
- Photos are stored as binary files in the vault. They are not git-tracked unless you configure git-lfs.

---

## Development

```bash
git clone https://github.com/juppinger0/obsidian-family-tree
cd obsidian-family-tree
npm install
npm run build        # production build → main.js
```

Copy `main.js`, `manifest.json` and `styles.css` to `.obsidian/plugins/people-tree/` in your vault and reload the plugin in Obsidian.

---

## License

MIT — © Jörg Lortz
