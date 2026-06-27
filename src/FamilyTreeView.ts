import { App, ItemView, TFile, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_FAMILY_TREE = 'people-tree-view';

type ViewMode = 'tree' | 'orgchart' | 'timeline' | 'list';

const NODE_W = 190;
const NODE_H = 72;
const H_GAP = 60;
const V_GAP = 110;
const TL_PX_PER_YEAR = 90; // px per year in timeline mode

interface Person {
    id: string;
    name: string;
    born: string;
    died: string;
    avatar: string;
    parents: string[];
    spouse: string;
    children: string[];
    file: TFile;
    generation: number;
    col: number;
    extra: Record<string, unknown>;
}

export class FamilyTreeView extends ItemView {
    private persons: Map<string, Person> = new Map();
    private zoom = 1;
    private panX = 0;
    private panY = 0;
    private selectedPerson: string | null = null;
    private expandedPersons: Set<string> = new Set();
    private viewMode: ViewMode = 'tree';
    private filterText = '';
    private sortField = 'name';
    private sortDir: 1 | -1 = 1;
    private listTbody: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, private app: App) { super(leaf); }

    getViewType() { return VIEW_TYPE_FAMILY_TREE; }
    getDisplayText() { return 'People Tree'; }
    getIcon() { return 'users'; }

    async onOpen() {
        this.containerEl.children[1].addClass('family-tree-root');
        await this.render();
        this.registerEvent(this.app.metadataCache.on('changed', () => this.render()));
    }
    async onClose() {}

    // ── Data ──────────────────────────────────────────────────────────────

    private async loadPersons() {
        this.persons.clear();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!fm || fm.type !== 'person') continue;
            const { type: _t, name: fmName, born, died, avatar, parents, spouse, children, position: _p, ...extra } = fm;
            const name = (fmName as string) || file.basename;
            this.persons.set(name, {
                id: name, name,
                born: born ?? '', died: died ?? '', avatar: avatar ?? '',
                parents: toArray(parents), spouse: spouse ?? '',
                children: toArray(children),
                file, generation: -1, col: 0, extra: extra ?? {},
            });
        }
    }

    // ── Layout ────────────────────────────────────────────────────────────

    private assignGenerations() {
        for (const p of this.persons.values())
            if (!p.parents.some(n => this.persons.has(n))) p.generation = 0;
        let changed = true;
        while (changed) {
            changed = false;
            for (const p of this.persons.values()) {
                if (p.generation < 0) continue;
                for (const cn of p.children) {
                    const c = this.persons.get(cn);
                    if (c && c.generation < p.generation + 1) { c.generation = p.generation + 1; changed = true; }
                }
            }
        }
        for (const p of this.persons.values()) if (p.generation < 0) p.generation = 0;
    }

    private assignColumns() {
        for (const persons of this.byGeneration().values()) {
            const placed = new Set<string>();
            const ordered: Person[] = [];
            for (const p of persons) {
                if (placed.has(p.name)) continue;
                ordered.push(p); placed.add(p.name);
                if (p.spouse) {
                    const sp = this.persons.get(p.spouse);
                    if (sp && !placed.has(sp.name)) { ordered.push(sp); placed.add(sp.name); }
                }
            }
            ordered.forEach((p, i) => { p.col = i; });
        }
    }

    private byGeneration(): Map<number, Person[]> {
        const map: Map<number, Person[]> = new Map();
        for (const p of this.persons.values()) {
            if (!map.has(p.generation)) map.set(p.generation, []);
            map.get(p.generation)!.push(p);
        }
        return map;
    }

    // ── Render dispatch ───────────────────────────────────────────────────

    async render() {
        await this.loadPersons();
        this.assignGenerations();
        this.assignColumns();

        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();

        if (this.persons.size === 0) {
            root.createEl('p', { text: 'Keine Personen gefunden. Notizen mit type: person anlegen.', cls: 'ft-empty' });
            return;
        }

        this.renderToolbar(root.createDiv({ cls: 'ft-toolbar' }));

        if (this.viewMode === 'list') { this.renderList(root); return; }

        const viewport = root.createDiv({ cls: 'ft-viewport' });
        const canvas = viewport.createDiv({ cls: 'ft-canvas' });
        const svg = this.createSvg(canvas, 1, 1); // will be resized

        const byGen = this.byGeneration();

        if (this.viewMode === 'timeline') {
            this.renderTimeline(canvas, svg, byGen, viewport);
        } else {
            this.renderTreeOrOrg(canvas, svg, byGen);
        }

        if (this.selectedPerson) this.applySelection(this.selectedPerson);
        this.setupZoomPan(viewport, canvas);
        this.applyTransform(canvas);
    }

    // ── Toolbar ───────────────────────────────────────────────────────────

    private renderToolbar(tb: HTMLElement) {
        const modeGroup = tb.createDiv({ cls: 'ft-mode-group' });
        const modes: { id: ViewMode; emoji: string; label: string }[] = [
            { id: 'tree',      emoji: '🌳', label: 'Stammbaum' },
            { id: 'orgchart',  emoji: '🏢', label: 'Org-Chart' },
            { id: 'timeline',  emoji: '📅', label: 'Zeitstrahl' },
            { id: 'list',      emoji: '📋', label: 'Liste' },
        ];
        for (const m of modes) {
            const b = modeGroup.createEl('button', { cls: 'ft-mode-btn', title: m.label });
            b.createSpan({ text: m.emoji });
            b.createEl('span', { text: ` ${m.label}` });
            if (this.viewMode === m.id) b.addClass('active');
            b.addEventListener('click', () => { this.viewMode = m.id; this.zoom = 1; this.panX = 0; this.panY = 0; this.render(); });
        }

        if (this.viewMode !== 'list') {
            const zoomGroup = tb.createDiv({ cls: 'ft-zoom-group' });
            const z = (t: string, title: string, fn: () => void) => {
                const b = zoomGroup.createEl('button', { text: t, cls: 'ft-tb-btn', title });
                b.addEventListener('click', fn);
            };
            z('+', 'Hineinzoomen', () => { this.zoom = Math.min(this.zoom * 1.2, 4); this.applyTransform(this.getCanvas()); });
            z('−', 'Herauszoomen', () => { this.zoom = Math.max(this.zoom / 1.2, 0.15); this.applyTransform(this.getCanvas()); });
            z('⌂', 'Zurücksetzen', () => { this.zoom = 1; this.panX = 0; this.panY = 0; this.applyTransform(this.getCanvas()); });
        }

        if (this.viewMode === 'list') {
            const search = tb.createEl('input', { type: 'text', placeholder: '🔍 Suchen…', cls: 'ft-search', value: this.filterText });
            search.addEventListener('input', () => { this.filterText = search.value; this.rebuildListBody(); });
        }

        const hint = this.viewMode !== 'list'
            ? 'Mausrad: Zoom  ·  Drag: Pan  ·  Klick: Auswahl  ·  ▼: Details'
            : `${this.persons.size} Personen`;
        tb.createEl('span', { cls: 'ft-tb-hint', text: hint });
    }

    // ── Tree & Org-Chart mode ─────────────────────────────────────────────

    private renderTreeOrOrg(canvas: HTMLElement, svg: SVGElement, byGen: Map<number, Person[]>) {
        const maxGen = Math.max(...byGen.keys());
        const maxCols = Math.max(...[...byGen.values()].map(g => g.length));
        const totalW = maxCols * (NODE_W + H_GAP) + H_GAP;
        const totalH = (maxGen + 1) * (NODE_H + V_GAP) + V_GAP;

        this.resizeSvg(svg, totalW, totalH);
        canvas.style.width = totalW + 'px';
        canvas.style.height = totalH + 'px';

        const pos: Map<string, { x: number; y: number }> = new Map();

        for (const [gen, persons] of byGen) {
            const rowW = persons.length * NODE_W + (persons.length - 1) * H_GAP;
            const startX = (totalW - rowW) / 2;
            persons.forEach((p, i) => {
                const x = startX + i * (NODE_W + H_GAP);
                const y = V_GAP / 2 + gen * (NODE_H + V_GAP);
                pos.set(p.name, { x, y });
                this.renderNode(canvas, p, x, y);
            });
        }

        for (const person of this.persons.values()) {
            const cp = pos.get(person.name);
            if (!cp) continue;
            for (const pn of person.parents) {
                const pp = pos.get(pn);
                if (pp) this.drawConnector(svg, pp.x + NODE_W / 2, pp.y + NODE_H, cp.x + NODE_W / 2, cp.y, pn, person.name, 'parent');
            }
            if (person.spouse && person.name < person.spouse) {
                const sp = pos.get(person.spouse), p1 = pos.get(person.name);
                if (sp && p1) this.drawConnector(svg, p1.x + NODE_W, p1.y + NODE_H / 2, sp.x, sp.y + NODE_H / 2, person.name, person.spouse, 'spouse');
            }
        }
    }

    // ── Timeline mode ─────────────────────────────────────────────────────

    private renderTimeline(canvas: HTMLElement, svg: SVGElement, byGen: Map<number, Person[]>, viewport: HTMLElement) {
        const years = [...this.persons.values()].map(p => extractYear(p.born)).filter((y): y is number => y !== null);
        if (years.length < 2) {
            canvas.createEl('p', { text: 'Zu wenige Geburtsdaten für Zeitstrahl. Bitte born-Felder ergänzen.', cls: 'ft-empty' });
            return;
        }

        const minYear = Math.min(...years) - 5;
        const maxYear = Math.max(...years) + 15;
        const totalW = Math.max((maxYear - minYear) * TL_PX_PER_YEAR + 120, 800);
        const maxGen = Math.max(...byGen.keys());
        const totalH = (maxGen + 1) * (NODE_H + V_GAP) + V_GAP + 50;

        this.resizeSvg(svg, totalW, totalH);
        canvas.style.width = totalW + 'px';
        canvas.style.height = totalH + 'px';
        canvas.addClass('ft-canvas-timeline');

        // Year axis
        this.drawYearAxis(svg, minYear, maxYear, totalW, totalH);

        const pos: Map<string, { x: number; y: number }> = new Map();

        for (const [gen, persons] of byGen) {
            const y = V_GAP / 2 + gen * (NODE_H + V_GAP);
            // First pass: place by known year
            const placed: { person: Person; x: number }[] = [];
            const unplaced: Person[] = [];
            for (const p of persons) {
                const yr = extractYear(p.born);
                if (yr !== null) {
                    placed.push({ person: p, x: 60 + (yr - minYear) * TL_PX_PER_YEAR });
                } else {
                    unplaced.push(p);
                }
            }
            // Second pass: unplaced → average of sibling positions or row center
            for (const p of unplaced) {
                const siblingXs = placed.filter(pl => pl.person.generation === gen).map(pl => pl.x);
                const x = siblingXs.length ? siblingXs.reduce((a, b) => a + b, 0) / siblingXs.length : totalW / 2;
                placed.push({ person: p, x });
            }
            for (const { person, x } of placed) {
                pos.set(person.name, { x, y });
                this.renderNode(canvas, person, x - NODE_W / 2, y);
            }
        }

        // Draw connections
        for (const person of this.persons.values()) {
            const cp = pos.get(person.name);
            if (!cp) continue;
            for (const pn of person.parents) {
                const pp = pos.get(pn);
                if (pp) this.drawConnector(svg, pp.x, pp.y + NODE_H, cp.x, cp.y, pn, person.name, 'parent');
            }
            if (person.spouse && person.name < person.spouse) {
                const sp = pos.get(person.spouse), p1 = pos.get(person.name);
                if (sp && p1) this.drawConnector(svg, p1.x + NODE_W / 2, p1.y + NODE_H / 2, sp.x - NODE_W / 2, sp.y + NODE_H / 2, person.name, person.spouse, 'spouse');
            }
        }
    }

    private drawYearAxis(svg: SVGElement, minYear: number, maxYear: number, totalW: number, totalH: number) {
        // Axis line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '40'); line.setAttribute('x2', String(totalW - 20));
        line.setAttribute('y1', String(totalH - 30)); line.setAttribute('y2', String(totalH - 30));
        line.setAttribute('stroke', 'var(--background-modifier-border)'); line.setAttribute('stroke-width', '1');
        svg.appendChild(line);

        // Year ticks every 10 years
        const startDecade = Math.ceil(minYear / 10) * 10;
        for (let yr = startDecade; yr <= maxYear; yr += 10) {
            const x = 60 + (yr - minYear) * TL_PX_PER_YEAR;
            const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            tick.setAttribute('x1', String(x)); tick.setAttribute('x2', String(x));
            tick.setAttribute('y1', String(totalH - 36)); tick.setAttribute('y2', String(totalH - 24));
            tick.setAttribute('stroke', 'var(--text-faint)'); tick.setAttribute('stroke-width', '1');
            svg.appendChild(tick);
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', String(x)); label.setAttribute('y', String(totalH - 10));
            label.setAttribute('text-anchor', 'middle'); label.setAttribute('font-size', '11');
            label.setAttribute('fill', 'var(--text-faint)');
            label.textContent = String(yr);
            svg.appendChild(label);
            // Vertical grid line
            const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            grid.setAttribute('x1', String(x)); grid.setAttribute('x2', String(x));
            grid.setAttribute('y1', '0'); grid.setAttribute('y2', String(totalH - 36));
            grid.setAttribute('stroke', 'var(--background-modifier-border)'); grid.setAttribute('stroke-width', '1');
            grid.setAttribute('stroke-dasharray', '3,4'); grid.setAttribute('opacity', '0.5');
            svg.appendChild(grid);
        }
    }

    // ── List mode ─────────────────────────────────────────────────────────

    private renderList(root: HTMLElement) {
        const container = root.createDiv({ cls: 'ft-list-container' });
        const table = container.createEl('table', { cls: 'ft-table' });
        const thead = table.createEl('thead');
        const headRow = thead.createEl('tr');

        const cols: { label: string; field: string | null }[] = [
            { label: '', field: null },
            { label: 'Name', field: 'name' },
            { label: 'Geburt', field: 'born' },
            { label: 'Tod', field: 'died' },
            { label: 'Eltern', field: 'parents' },
            { label: 'Ehepartner', field: 'spouse' },
            { label: 'Kinder', field: 'children' },
            { label: '', field: null },
        ];

        for (const col of cols) {
            const th = headRow.createEl('th', { text: col.field ? col.label : '' });
            if (col.field) {
                th.addClass('ft-th-sortable');
                const isActive = this.sortField === col.field;
                if (isActive) th.createSpan({ cls: 'ft-sort-arrow', text: this.sortDir === 1 ? ' ↑' : ' ↓' });
                th.addEventListener('click', () => {
                    if (this.sortField === col.field) this.sortDir = this.sortDir === 1 ? -1 : 1;
                    else { this.sortField = col.field!; this.sortDir = 1; }
                    this.render();
                });
            }
        }

        this.listTbody = table.createEl('tbody') as HTMLElement;
        this.rebuildListBody();
    }

    private rebuildListBody() {
        if (!this.listTbody) return;
        this.listTbody.empty();

        const filter = this.filterText.toLowerCase();
        const persons = [...this.persons.values()]
            .filter(p => !filter || p.name.toLowerCase().includes(filter) ||
                p.born.toLowerCase().includes(filter) ||
                p.parents.join(' ').toLowerCase().includes(filter))
            .sort((a, b) => {
                let va = '', vb = '';
                const f = this.sortField as keyof Person;
                const av = a[f], bv = b[f];
                if (Array.isArray(av)) va = (av as string[]).join(', ');
                else va = String(av ?? '');
                if (Array.isArray(bv)) vb = (bv as string[]).join(', ');
                else vb = String(bv ?? '');
                return va.localeCompare(vb, 'de') * this.sortDir;
            });

        for (const person of persons) {
            const row = this.listTbody.createEl('tr', { cls: 'ft-list-row' });

            // Avatar (klickbar für Upload)
            const avatarCell = row.createEl('td', { cls: 'ft-list-avatar-cell' });
            this.renderAvatarCircle(avatarCell, person, 32, true);

            // Name
            row.createEl('td', { cls: 'ft-list-name', text: person.name });

            // Born / Died / Parents / Spouse / Children
            row.createEl('td', { text: person.born || '—' });
            row.createEl('td', { text: person.died || '—' });
            row.createEl('td', { text: person.parents.join(', ') || '—' });
            row.createEl('td', { text: person.spouse || '—' });
            row.createEl('td', { text: person.children.join(', ') || '—' });

            // Actions
            const actCell = row.createEl('td', { cls: 'ft-list-actions' });
            actCell.createEl('button', { text: '↗', cls: 'ft-list-btn', title: 'Notiz öffnen' })
                .addEventListener('click', () => this.app.workspace.openLinkText(person.file.path, ''));

            // Inline editing on cell click
            for (const [i, field] of ['born', 'died', 'parents', 'spouse', 'children'].entries()) {
                const cell = row.cells[i + 2] as HTMLTableCellElement;
                const isArr = field === 'parents' || field === 'children';
                const rawVal = isArr ? (person[field as 'parents' | 'children'] as string[]).join(', ') : (person[field as 'born' | 'died' | 'spouse'] as string);
                cell.title = 'Klick zum Bearbeiten';
                cell.addEventListener('click', () => {
                    if (cell.querySelector('input')) return;
                    this.startEdit(cell, rawVal, async (v) => {
                        cell.textContent = v || '—';
                        await this.app.fileManager.processFrontMatter(person.file, (fm) => {
                            fm[field] = isArr ? v.split(',').map((s: string) => s.trim()).filter(Boolean) : (v || null);
                        });
                    }, () => { cell.textContent = rawVal || '—'; });
                });
            }
        }
    }

    // ── Node rendering ────────────────────────────────────────────────────

    private renderNode(parent: HTMLElement, person: Person, x: number, y: number) {
        const node = parent.createDiv({ cls: 'ft-node' });
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        node.style.width = NODE_W + 'px';
        node.dataset.person = person.name;
        if (this.expandedPersons.has(person.name)) node.addClass('expanded');

        const header = node.createDiv({ cls: 'ft-node-header' });

        // Avatar
        this.renderAvatarCircle(header, person, 40);

        const info = header.createDiv({ cls: 'ft-node-info' });
        const nameEl = info.createDiv({ cls: 'ft-name', text: person.name });
        this.makeEditable(nameEl, person, 'name', person.name);
        const datesEl = info.createDiv({ cls: 'ft-dates', text: formatDates(person.born, person.died) });
        this.makeEditable(datesEl, person, 'born', person.born, (v) => formatDates(v, person.died));

        const btns = header.createDiv({ cls: 'ft-node-btns' });
        const openBtn = btns.createEl('button', { cls: 'ft-icon-btn', title: 'Notiz öffnen', text: '↗' });
        openBtn.addEventListener('click', (e) => { e.stopPropagation(); this.app.workspace.openLinkText(person.file.path, ''); });
        const isExp = this.expandedPersons.has(person.name);
        const expandBtn = btns.createEl('button', { cls: 'ft-icon-btn', title: 'Details', text: isExp ? '▲' : '▼' });
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.expandedPersons.has(person.name)) this.expandedPersons.delete(person.name);
            else this.expandedPersons.add(person.name);
            this.render();
        });

        const detail = node.createDiv({ cls: 'ft-detail' });
        this.detailField(detail, person, 'Geburtsdatum', 'born', person.born, false);
        this.detailField(detail, person, 'Sterbedatum', 'died', person.died, false);
        this.detailField(detail, person, 'Ehepartner', 'spouse', person.spouse, false);
        this.detailField(detail, person, 'Eltern', 'parents', person.parents.join(', '), true);
        this.detailField(detail, person, 'Kinder', 'children', person.children.join(', '), true);
        this.detailField(detail, person, 'Foto (Vault-Pfad)', 'avatar', person.avatar, false);

        for (const [key, val] of Object.entries(person.extra)) {
            const v = Array.isArray(val) ? (val as string[]).join(', ') : String(val ?? '');
            this.detailField(detail, person, key, key, v, Array.isArray(val));
        }

        const addRow = detail.createDiv({ cls: 'ft-add-row' });
        const addBtn = addRow.createEl('button', { cls: 'ft-add-btn', text: '+ Feld hinzufügen' });
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showAddField(addRow, person, addBtn); });

        node.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('button, input')) return;
            this.selectedPerson = this.selectedPerson === person.name ? null : person.name;
            this.applySelection(this.selectedPerson);
        });
    }

    // ── Avatar ────────────────────────────────────────────────────────────

    private renderAvatarCircle(parent: HTMLElement, person: Person, size: number, uploadable = false) {
        // Use <label> when uploadable so the nested <input type=file> is triggered natively on click
        const wrap = uploadable
            ? parent.createEl('label', { cls: 'ft-avatar-wrap ft-avatar-uploadable', title: 'Foto hochladen' })
            : parent.createDiv({ cls: 'ft-avatar-wrap' });
        (wrap as HTMLElement).style.width = size + 'px';
        (wrap as HTMLElement).style.height = size + 'px';
        (wrap as HTMLElement).style.minWidth = size + 'px';

        if (uploadable) {
            const input = (wrap as HTMLElement).createEl('input', { type: 'file' }) as HTMLInputElement;
            input.accept = 'image/*';
            input.style.cssText = 'display:none;position:absolute;width:0;height:0';
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) return;
                const buffer = await file.arrayBuffer();
                const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
                const folderPath = '02 Areas/Familie/Fotos';
                const targetPath = `${folderPath}/${person.name}.${ext}`;
                try {
                    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
                        await this.app.vault.createFolder(folderPath);
                    }
                    const existing = this.app.vault.getAbstractFileByPath(targetPath);
                    if (existing instanceof TFile) {
                        await this.app.vault.modifyBinary(existing, buffer);
                    } else {
                        await this.app.vault.createBinary(targetPath, buffer);
                    }
                    await this.app.fileManager.processFrontMatter(person.file, (fm) => { fm.avatar = targetPath; });
                    await this.render();
                } catch (err) {
                    console.error('[PeopleTree] Avatar-Upload:', err);
                }
            });
        }

        if (person.avatar) {
            const f = this.app.vault.getAbstractFileByPath(person.avatar);
            if (f instanceof TFile) {
                const img = (wrap as HTMLElement).createEl('img', { cls: 'ft-avatar' });
                img.src = this.app.vault.getResourcePath(f);
                if (uploadable) (wrap as HTMLElement).createDiv({ cls: 'ft-avatar-overlay', text: '📷' });
                return;
            }
        }

        const initials = person.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
        (wrap as HTMLElement).createDiv({ cls: 'ft-avatar-initials', text: initials });
        if (uploadable) (wrap as HTMLElement).createDiv({ cls: 'ft-avatar-overlay', text: '📷' });
    }

    // ── Detail fields ─────────────────────────────────────────────────────

    private detailField(parent: HTMLElement, person: Person, label: string, field: string, value: string, isArray: boolean) {
        const row = parent.createDiv({ cls: 'ft-detail-row' });
        row.createEl('span', { cls: 'ft-label', text: label });
        const val = row.createEl('span', { cls: 'ft-val', text: value || '—' });
        val.title = 'Klick zum Bearbeiten';
        val.addEventListener('click', (e) => { e.stopPropagation(); this.inlineEdit(val, person, field, value, isArray); });
    }

    private showAddField(container: HTMLElement, person: Person, trigger: HTMLElement) {
        trigger.remove();
        const row = container.createDiv({ cls: 'ft-new-field-row' });
        const key = row.createEl('input', { type: 'text', placeholder: 'Feldname', cls: 'ft-new-key' });
        const val = row.createEl('input', { type: 'text', placeholder: 'Wert', cls: 'ft-new-val' });
        const save = row.createEl('button', { text: '✓', cls: 'ft-save-new' });
        key.focus();
        save.addEventListener('click', async () => {
            if (!key.value.trim()) return;
            await this.app.fileManager.processFrontMatter(person.file, (fm) => { fm[key.value.trim()] = val.value.trim(); });
            await this.render();
        });
    }

    // ── Editing ───────────────────────────────────────────────────────────

    private makeEditable(el: HTMLElement, person: Person, field: string, raw: string, display?: (v: string) => string) {
        el.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (el.querySelector('input')) return;
            this.startEdit(el, raw, async (v) => {
                el.textContent = display ? display(v) : v;
                if (v !== raw) {
                    (person as Record<string, unknown>)[field] = v;
                    await this.app.fileManager.processFrontMatter(person.file, (fm) => { fm[field] = v || null; });
                }
            }, () => { el.textContent = display ? display(raw) : raw; });
        });
    }

    private inlineEdit(el: HTMLElement, person: Person, field: string, raw: string, isArray: boolean) {
        if (el.querySelector('input')) return;
        this.startEdit(el, raw, async (v) => {
            el.textContent = v || '—';
            await this.app.fileManager.processFrontMatter(person.file, (fm) => {
                fm[field] = isArray ? v.split(',').map((s: string) => s.trim()).filter(Boolean) : (v || null);
            });
        }, () => { el.textContent = raw || '—'; });
    }

    private startEdit(el: HTMLElement, value: string, onSave: (v: string) => Promise<void>, onCancel: () => void) {
        const input = createEl('input', { type: 'text', value, cls: 'ft-inline-input' });
        el.empty(); el.appendChild(input);
        input.focus(); input.select();
        let done = false;
        const save = async () => { if (done) return; done = true; await onSave(input.value.trim()); };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { done = true; onCancel(); }
        });
    }

    // ── Selection ─────────────────────────────────────────────────────────

    private applySelection(name: string | null) {
        const canvas = this.getCanvas();
        if (!canvas) return;
        canvas.querySelectorAll<HTMLElement>('.ft-node').forEach(node => {
            node.classList.remove('selected', 'dimmed');
            if (!name) return;
            if (node.dataset.person === name) { node.classList.add('selected'); return; }
            const p = this.persons.get(node.dataset.person!), s = this.persons.get(name);
            if (!p || !s) return;
            const connected = p.parents.includes(name) || p.children.includes(name) ||
                s.parents.includes(p.name) || s.children.includes(p.name) ||
                p.spouse === name || s.spouse === p.name;
            if (!connected) node.classList.add('dimmed');
        });
        canvas.querySelectorAll<SVGElement>('.ft-line').forEach(line => {
            line.classList.remove('ft-line-active', 'ft-line-dim');
            if (!name) return;
            if (line.dataset.a === name || line.dataset.b === name) line.classList.add('ft-line-active');
            else line.classList.add('ft-line-dim');
        });
    }

    // ── Zoom/Pan ──────────────────────────────────────────────────────────

    private setupZoomPan(viewport: HTMLElement, canvas: HTMLElement) {
        let panning = false, sx = 0, sy = 0;
        viewport.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement).closest('.ft-node')) return;
            panning = true; sx = e.clientX - this.panX; sy = e.clientY - this.panY;
            viewport.style.cursor = 'grabbing';
        });
        viewport.addEventListener('mousemove', (e) => {
            if (!panning) return;
            this.panX = e.clientX - sx; this.panY = e.clientY - sy;
            this.applyTransform(canvas);
        });
        const stop = () => { panning = false; viewport.style.cursor = 'grab'; };
        viewport.addEventListener('mouseup', stop);
        viewport.addEventListener('mouseleave', stop);
        viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom = Math.min(Math.max(this.zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.15), 4);
            this.applyTransform(canvas);
        }, { passive: false });
    }

    private applyTransform(canvas: HTMLElement | null) {
        if (canvas) canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }

    private getCanvas(): HTMLElement { return this.containerEl.querySelector('.ft-canvas') as HTMLElement; }

    // ── SVG helpers ───────────────────────────────────────────────────────

    private createSvg(parent: HTMLElement, w: number, h: number): SVGElement {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h));
        svg.classList.add('ft-svg');
        parent.appendChild(svg);
        return svg;
    }

    private resizeSvg(svg: SVGElement, w: number, h: number) {
        svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h));
    }

    private drawConnector(svg: SVGElement, x1: number, y1: number, x2: number, y2: number, a: string, b: string, type: 'parent' | 'spouse') {
        const el = document.createElementNS('http://www.w3.org/2000/svg', type === 'spouse' ? 'line' : 'path') as SVGElement;
        el.classList.add('ft-line', `ft-line-${type}`);
        el.dataset.a = a; el.dataset.b = b;

        if (type === 'parent') {
            const d = this.viewMode === 'orgchart'
                ? elbow(x1, y1, x2, y2)       // right-angle for org chart
                : bezier(x1, y1, x2, y2);      // smooth curve for tree + timeline
            (el as SVGPathElement).setAttribute('d', d);
            (el as SVGPathElement).setAttribute('fill', 'none');
        } else {
            (el as SVGLineElement).setAttribute('x1', String(x1)); (el as SVGLineElement).setAttribute('y1', String(y1));
            (el as SVGLineElement).setAttribute('x2', String(x2)); (el as SVGLineElement).setAttribute('y2', String(y2));
        }
        svg.appendChild(el);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function bezier(x1: number, y1: number, x2: number, y2: number): string {
    const my = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

function elbow(x1: number, y1: number, x2: number, y2: number): string {
    const mid = (y1 + y2) / 2;
    return `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`;
}

function toArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string' && val) return [val];
    return [];
}

function extractYear(dateStr: string): number | null {
    if (!dateStr) return null;
    const m = dateStr.match(/\b(\d{4})\b/);
    return m ? parseInt(m[1]) : null;
}

function formatDates(born: string, died: string): string {
    return (born ? `* ${born}` : '* ?') + (died ? ` † ${died}` : '');
}
