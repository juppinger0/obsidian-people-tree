import { App, ItemView, Modal, TFile, WorkspaceLeaf } from 'obsidian';
import type { PeopleTreeSettings } from './main';

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
    private layoutPos: Map<string, { x: number; y: number }> = new Map();
    private layoutW = 0;
    private layoutH = 0;

    constructor(leaf: WorkspaceLeaf, private app: App, private settings: PeopleTreeSettings) { super(leaf); }

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
        const folder = this.settings.personFolder;
        for (const file of this.app.vault.getMarkdownFiles()) {
            if (folder && !file.path.startsWith(folder)) continue;
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
        document.querySelectorAll('.ft-autocomplete').forEach(el => el.remove());
        await this.loadPersons();
        this.assignGenerations();
        this.assignColumns();

        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();

        if (this.persons.size === 0) {
            this.renderOnboarding(root);
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

    // ── Onboarding ────────────────────────────────────────────────────────

    private renderOnboarding(root: HTMLElement) {
        const card = root.createDiv({ cls: 'ft-onboarding' });
        card.createDiv({ cls: 'ft-onboarding-icon', text: '👥' });
        card.createEl('h2', { cls: 'ft-onboarding-title', text: 'Welcome to People Tree' });
        card.createEl('p', { cls: 'ft-onboarding-desc', text: 'No person notes found yet. Create Markdown notes with type: person in the frontmatter — People Tree picks them up automatically.' });

        const steps = card.createEl('ol', { cls: 'ft-onboarding-steps' });
        steps.createEl('li', { text: 'Click the button below to create your first person note.' });
        steps.createEl('li', { text: 'Fill in name, born, parents, children as needed.' });
        steps.createEl('li', { text: 'The tree updates automatically.' });
        if (this.settings.personFolder) {
            card.createEl('p', { cls: 'ft-onboarding-hint', text: `Scanning folder: ${this.settings.personFolder}` });
        }

        const btn = card.createEl('button', { cls: 'ft-onboarding-btn', text: '+ Create first person' });
        btn.addEventListener('click', () => this.createPersonNote());
    }

    private async createPersonNote() {
        const folder = this.settings.personFolder?.trim() || '';
        const base = 'New Person';
        let path = folder ? `${folder}/${base}.md` : `${base}.md`;
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
        }
        if (!this.app.vault.getAbstractFileByPath(path)) {
            await this.app.vault.create(path, `---\ntype: person\nname: ${base}\nborn: \ndied: \nparents: \nspouse: \nchildren: \n---\n`);
        }
        await this.app.workspace.openLinkText(path, '');
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

        const newPersonBtn = tb.createEl('button', { cls: 'ft-new-person-btn', title: 'Neue Person anlegen' });
        newPersonBtn.createSpan({ text: '+ Person' });
        newPersonBtn.addEventListener('click', () => new AddPersonModal(this.app, 'none', null, this.settings.personFolder, () => this.render(), this.persons).open());

        if (this.viewMode !== 'list') {
            const zoomGroup = tb.createDiv({ cls: 'ft-zoom-group' });
            const z = (t: string, title: string, fn: () => void) => {
                const b = zoomGroup.createEl('button', { text: t, cls: 'ft-tb-btn', title });
                b.addEventListener('click', fn);
            };
            z('+', 'Hineinzoomen', () => { this.zoom = Math.min(this.zoom * 1.2, 4); this.applyTransform(this.getCanvas()); });
            z('−', 'Herauszoomen', () => { this.zoom = Math.max(this.zoom / 1.2, 0.15); this.applyTransform(this.getCanvas()); });
            z('⌂', 'Zurücksetzen', () => { this.zoom = 1; this.panX = 0; this.panY = 0; this.applyTransform(this.getCanvas()); });

            const exportBtn = tb.createEl('button', { cls: 'ft-export-btn', title: 'Als PNG herunterladen' });
            exportBtn.createSpan({ text: '⬇ PNG' });
            exportBtn.addEventListener('click', () => this.exportPng());
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

        this.layoutPos = pos;
        this.layoutW = totalW;
        this.layoutH = totalH;

        // Spouse connections + diamond markers
        for (const person of this.persons.values()) {
            if (person.spouse && person.name < person.spouse) {
                const sp = pos.get(person.spouse), p1 = pos.get(person.name);
                if (sp && p1) {
                    this.drawConnector(svg, p1.x + NODE_W, p1.y + NODE_H / 2, sp.x, sp.y + NODE_H / 2, person.name, person.spouse, 'spouse');
                    this.drawSpouseMarker(svg, (p1.x + NODE_W + sp.x) / 2, p1.y + NODE_H / 2);
                }
            }
        }

        // Parent→child connections — single line from couple midpoint when both parents are spouses
        for (const person of this.persons.values()) {
            const cp = pos.get(person.name);
            if (!cp) continue;
            if (person.parents.length === 2) {
                const [p1n, p2n] = person.parents;
                const pp1 = pos.get(p1n), pp2 = pos.get(p2n);
                const par1 = this.persons.get(p1n), par2 = this.persons.get(p2n);
                if (pp1 && pp2 && par1 && par2 && (par1.spouse === p2n || par2.spouse === p1n)) {
                    const midX = (pp1.x + pp2.x + NODE_W) / 2;
                    this.drawConnector(svg, midX, pp1.y + NODE_H, cp.x + NODE_W / 2, cp.y, p1n, person.name, 'parent');
                    continue;
                }
            }
            for (const pn of person.parents) {
                const pp = pos.get(pn);
                if (pp) this.drawConnector(svg, pp.x + NODE_W / 2, pp.y + NODE_H, cp.x + NODE_W / 2, cp.y, pn, person.name, 'parent');
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

        // Store layout (pos has center-X; adjust to top-left for export)
        const tlAdjusted = new Map<string, { x: number; y: number }>();
        for (const [n, p] of pos) tlAdjusted.set(n, { x: p.x - NODE_W / 2, y: p.y });
        this.layoutPos = tlAdjusted;
        this.layoutW = totalW;
        this.layoutH = totalH;

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
                if (sp && p1) {
                    this.drawConnector(svg, p1.x + NODE_W / 2, p1.y + NODE_H / 2, sp.x - NODE_W / 2, sp.y + NODE_H / 2, person.name, person.spouse, 'spouse');
                    this.drawSpouseMarker(svg, (p1.x + NODE_W / 2 + sp.x - NODE_W / 2) / 2, p1.y + NODE_H / 2);
                }
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

            // Avatar
            const avatarCell = row.createEl('td', { cls: 'ft-list-avatar-cell' });
            this.renderAvatarCircle(avatarCell, person, 32);

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
            actCell.createEl('button', { text: '📷', cls: 'ft-list-btn', title: 'Foto hochladen/ändern' })
                .addEventListener('click', () => new AvatarUploadModal(this.app, person, this.settings.photosFolder, () => this.render()).open());
            actCell.createEl('button', { text: '🗑', cls: 'ft-list-btn ft-list-btn-danger', title: 'Person löschen' })
                .addEventListener('click', () => this.deletePerson(person));

            // Inline editing on cell click
            for (const [i, field] of ['born', 'died', 'parents', 'spouse', 'children'].entries()) {
                const cell = row.cells[i + 2] as HTMLTableCellElement;
                const isArr = field === 'parents' || field === 'children';
                const rawVal = isArr ? (person[field as 'parents' | 'children'] as string[]).join(', ') : (person[field as 'born' | 'died' | 'spouse'] as string);
                cell.title = 'Klick zum Bearbeiten';
                cell.addEventListener('click', () => {
                    if (cell.querySelector('input')) return;
                    const personFields = ['parents', 'children', 'spouse'];
                    const sugg = personFields.includes(field) ? [...this.persons.keys()] : [];
                    this.startEdit(cell, rawVal, async (v) => {
                        cell.textContent = v || '—';
                        await this.app.fileManager.processFrontMatter(person.file, (fm) => {
                            fm[field] = isArr ? v.split(',').map((s: string) => s.trim()).filter(Boolean) : (v || null);
                        });
                    }, () => { cell.textContent = rawVal || '—'; }, sugg);
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
        this.detailFieldWithAdd(detail, person, 'Eltern', 'parents', person.parents.join(', '), 'parent');
        this.detailFieldWithAdd(detail, person, 'Kinder', 'children', person.children.join(', '), 'child');
        // Avatar-Zeile mit 📷-Button
        const avatarRow = detail.createDiv({ cls: 'ft-detail-row' });
        avatarRow.createEl('span', { cls: 'ft-label', text: 'Foto' });
        const avatarVal = avatarRow.createEl('span', { cls: 'ft-val', text: person.avatar || '—' });
        avatarVal.title = 'Klick zum Bearbeiten (Vault-Pfad)';
        avatarVal.addEventListener('click', (e) => { e.stopPropagation(); this.inlineEdit(avatarVal, person, 'avatar', person.avatar, false); });
        avatarRow.createEl('button', { cls: 'ft-icon-btn', text: '📷', title: 'Foto hochladen' })
            .addEventListener('click', (e) => { e.stopPropagation(); new AvatarUploadModal(this.app, person, this.settings.photosFolder, () => this.render()).open(); });

        for (const [key, val] of Object.entries(person.extra)) {
            const v = Array.isArray(val) ? (val as string[]).join(', ') : String(val ?? '');
            this.detailField(detail, person, key, key, v, Array.isArray(val));
        }

        const addRow = detail.createDiv({ cls: 'ft-add-row' });
        const addBtn = addRow.createEl('button', { cls: 'ft-add-btn', text: '+ Feld hinzufügen' });
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showAddField(addRow, person, addBtn); });

        const deleteBtn = detail.createEl('button', { cls: 'ft-delete-person-btn', text: '🗑 Person löschen' });
        deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deletePerson(person); });

        node.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('button, input')) return;
            this.selectedPerson = this.selectedPerson === person.name ? null : person.name;
            this.applySelection(this.selectedPerson);
        });
    }

    // ── Avatar ────────────────────────────────────────────────────────────

    private renderAvatarCircle(parent: HTMLElement, person: Person, size: number) {
        const wrap = parent.createDiv({ cls: 'ft-avatar-wrap' });
        wrap.style.width = size + 'px';
        wrap.style.height = size + 'px';
        wrap.style.minWidth = size + 'px';

        if (person.avatar) {
            const f = this.app.vault.getAbstractFileByPath(person.avatar);
            if (f instanceof TFile) {
                wrap.createEl('img', { cls: 'ft-avatar' }).src = this.app.vault.getResourcePath(f);
                return;
            }
        }
        const initials = person.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
        wrap.createDiv({ cls: 'ft-avatar-initials', text: initials });
    }

    // ── Detail fields ─────────────────────────────────────────────────────

    private detailField(parent: HTMLElement, person: Person, label: string, field: string, value: string, isArray: boolean) {
        const row = parent.createDiv({ cls: 'ft-detail-row' });
        row.createEl('span', { cls: 'ft-label', text: label });
        const val = row.createEl('span', { cls: 'ft-val', text: value || '—' });
        val.title = 'Klick zum Bearbeiten';
        val.addEventListener('click', (e) => { e.stopPropagation(); this.inlineEdit(val, person, field, value, isArray); });
    }

    private detailFieldWithAdd(parent: HTMLElement, person: Person, label: string, field: 'parents' | 'children', value: string, relation: 'parent' | 'child') {
        const row = parent.createDiv({ cls: 'ft-detail-row' });
        row.createEl('span', { cls: 'ft-label', text: label });
        const val = row.createEl('span', { cls: 'ft-val', text: value || '—' });
        val.title = 'Klick zum Bearbeiten';
        val.addEventListener('click', (e) => { e.stopPropagation(); this.inlineEdit(val, person, field, value, true); });
        const addBtn = row.createEl('button', { cls: 'ft-icon-btn', text: '+', title: `${label.slice(0, -1)} hinzufügen` });
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); new AddPersonModal(this.app, relation, person, this.settings.personFolder, () => this.render(), this.persons).open(); });
    }

    private async deletePerson(person: Person) {
        const confirmed = await new Promise<boolean>(resolve => {
            const modal = new (class extends Modal {
                onOpen() {
                    this.contentEl.createEl('h3', { text: 'Person löschen?' });
                    this.contentEl.createEl('p', { text: `"${person.name}" wird dauerhaft gelöscht. Verweise in anderen Notizen werden nicht automatisch bereinigt.` });
                    const footer = this.contentEl.createDiv({ cls: 'ft-modal-footer' });
                    footer.createEl('button', { text: 'Abbrechen', cls: 'ft-modal-btn' })
                        .addEventListener('click', () => { this.close(); resolve(false); });
                    const del = footer.createEl('button', { text: 'Löschen', cls: 'ft-modal-btn ft-modal-btn-danger' });
                    del.style.marginLeft = '8px';
                    del.addEventListener('click', () => { this.close(); resolve(true); });
                }
                onClose() { this.contentEl.empty(); }
            })(this.app);
            modal.open();
        });
        if (!confirmed) return;
        await this.app.vault.delete(person.file);
        await this.render();
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
        const personNameFields = ['parents', 'children', 'spouse'];
        const suggestions = personNameFields.includes(field) ? [...this.persons.keys()] : [];
        this.startEdit(el, raw, async (v) => {
            el.textContent = v || '—';
            await this.app.fileManager.processFrontMatter(person.file, (fm) => {
                fm[field] = isArray ? v.split(',').map((s: string) => s.trim()).filter(Boolean) : (v || null);
            });
        }, () => { el.textContent = raw || '—'; }, suggestions);
    }

    private startEdit(el: HTMLElement, value: string, onSave: (v: string) => Promise<void>, onCancel: () => void, suggestions: string[] = []) {
        const input = createEl('input', { type: 'text', value, cls: 'ft-inline-input' });
        el.empty(); el.appendChild(input);
        input.focus(); input.select();

        let dropdown: HTMLElement | null = null;
        const closeDropdown = () => { dropdown?.remove(); dropdown = null; };

        if (suggestions.length) {
            dropdown = document.body.createDiv({ cls: 'ft-autocomplete' });

            const refreshDropdown = () => {
                if (!dropdown) return;
                const parts = input.value.split(',');
                const token = parts[parts.length - 1].trim().toLowerCase();
                dropdown.empty();
                if (!token) { dropdown.style.display = 'none'; return; }

                const matches = suggestions
                    .filter(s => s.toLowerCase().includes(token))
                    .slice(0, 8);

                if (!matches.length) { dropdown.style.display = 'none'; return; }

                const rect = input.getBoundingClientRect();
                Object.assign(dropdown.style, {
                    display: 'block',
                    top: (rect.bottom + 2) + 'px',
                    left: rect.left + 'px',
                    minWidth: Math.max(rect.width, 160) + 'px',
                });

                for (const match of matches) {
                    const item = dropdown.createDiv({ cls: 'ft-autocomplete-item', text: match });
                    item.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        const ps = input.value.split(',');
                        ps[ps.length - 1] = (ps.length > 1 ? ' ' : '') + match;
                        input.value = ps.join(',');
                        closeDropdown();
                        input.focus();
                    });
                }
            };

            input.addEventListener('input', refreshDropdown);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && dropdown?.style.display !== 'none') {
                    e.stopPropagation();
                    closeDropdown();
                }
            });
        }

        let done = false;
        const save = async () => {
            if (done) return; done = true;
            closeDropdown();
            await onSave(input.value.trim());
        };
        input.addEventListener('blur', () => setTimeout(save, 150));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape' && !dropdown) { done = true; closeDropdown(); onCancel(); }
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

    private drawSpouseMarker(svg: SVGElement, mx: number, my: number) {
        const d = 5;
        const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        diamond.setAttribute('points', `${mx},${my - d} ${mx + d},${my} ${mx},${my + d} ${mx - d},${my}`);
        diamond.classList.add('ft-spouse-marker');
        svg.appendChild(diamond);
    }

    // ── PNG Export ────────────────────────────────────────────────────────

    private async exportPng() {
        if (this.persons.size === 0 || this.layoutW === 0 || this.viewMode === 'list') return;
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = this.layoutW * scale;
        canvas.height = this.layoutH * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(scale, scale);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, this.layoutW, this.layoutH);

        // Connections
        for (const person of this.persons.values()) {
            const cp = this.layoutPos.get(person.name);
            if (!cp) continue;
            if (person.parents.length === 2) {
                const [p1n, p2n] = person.parents;
                const pp1 = this.layoutPos.get(p1n), pp2 = this.layoutPos.get(p2n);
                const par1 = this.persons.get(p1n), par2 = this.persons.get(p2n);
                if (pp1 && pp2 && par1 && par2 && (par1.spouse === p2n || par2.spouse === p1n)) {
                    const midX = (pp1.x + pp2.x + NODE_W) / 2;
                    this.canvasConnector(ctx, midX, pp1.y + NODE_H, cp.x + NODE_W / 2, cp.y, 'parent');
                    continue;
                }
            }
            for (const pn of person.parents) {
                const pp = this.layoutPos.get(pn);
                if (pp) this.canvasConnector(ctx, pp.x + NODE_W / 2, pp.y + NODE_H, cp.x + NODE_W / 2, cp.y, 'parent');
            }
            if (person.spouse && person.name < person.spouse) {
                const sp = this.layoutPos.get(person.spouse);
                if (sp) this.canvasConnector(ctx, cp.x + NODE_W, cp.y + NODE_H / 2, sp.x, sp.y + NODE_H / 2, 'spouse');
            }
        }

        // Person cards
        ctx.globalAlpha = 1;
        for (const [name, { x, y }] of this.layoutPos) {
            const person = this.persons.get(name);
            if (!person) continue;

            ctx.shadowColor = 'rgba(0,0,0,0.12)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;
            ctx.fillStyle = '#f5f5f5';
            canvasRoundRect(ctx, x, y, NODE_W, NODE_H, 8);
            ctx.fill();
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 1.5;
            ctx.stroke();

            // Avatar circle
            ctx.fillStyle = '#e2e2e2';
            ctx.beginPath(); ctx.arc(x + 26, y + NODE_H / 2, 18, 0, Math.PI * 2); ctx.fill();
            const ini = name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
            ctx.fillStyle = '#888'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(ini, x + 26, y + NODE_H / 2 + 4);

            // Text
            ctx.textAlign = 'left';
            ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 12px sans-serif';
            ctx.fillText(truncate(name, 22), x + 52, y + 28);
            ctx.fillStyle = '#888'; ctx.font = '10px sans-serif';
            ctx.fillText(formatDates(person.born, person.died), x + 52, y + 44);
        }

        canvas.toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `people-tree-${new Date().toISOString().slice(0, 10)}.png`;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
        }, 'image/png');
    }

    private canvasConnector(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, type: 'parent' | 'spouse') {
        ctx.beginPath();
        if (type === 'parent') {
            ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.55; ctx.setLineDash([]);
            const my = (y1 + y2) / 2;
            if (this.viewMode === 'orgchart') { ctx.moveTo(x1, y1); ctx.lineTo(x1, my); ctx.lineTo(x2, my); ctx.lineTo(x2, y2); }
            else { ctx.moveTo(x1, y1); ctx.bezierCurveTo(x1, my, x2, my, x2, y2); }
        } else {
            ctx.strokeStyle = '#d946ef'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.65; ctx.setLineDash([5, 4]);
            ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        }
        ctx.stroke(); ctx.setLineDash([]);
    }
}

// ── Avatar Upload Modal ───────────────────────────────────────────────────

class AvatarUploadModal extends Modal {
    constructor(private readonly obsApp: App, private readonly person: Person, private readonly photosFolder: string, private readonly onDone: () => void) {
        super(obsApp);
    }

    onOpen() {
        console.log('[PeopleTree] AvatarUploadModal.onOpen() for:', this.person.name);
        const { contentEl } = this;
        contentEl.createEl('h3', { text: `Photo for ${this.person.name}` });

        // ── Option A: drag & drop zone ──────────────────────────────────
        const dropZone = contentEl.createDiv({ cls: 'ft-drop-zone' });
        dropZone.createDiv({ cls: 'ft-drop-icon', text: '🖼️' });
        const dropLabel = dropZone.createDiv({ cls: 'ft-drop-label', text: 'Drag & drop image here' });
        dropZone.createDiv({ cls: 'ft-drop-sub', text: 'JPG, PNG, GIF, WEBP' });

        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.addClass('ft-drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.removeClass('ft-drag-over'));
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.removeClass('ft-drag-over');
            const file = e.dataTransfer?.files[0];
            if (!file || !file.type.startsWith('image/')) return;
            dropLabel.textContent = `⏳ ${file.name}…`;
            await this.saveFile(await file.arrayBuffer(), file.name);
        });

        // ── Option B: native file input, visible, user clicks it directly ──
        contentEl.createEl('p', { text: 'Or pick a file:', cls: 'ft-modal-label' });
        const fileInput = contentEl.createEl('input', { type: 'file' }) as HTMLInputElement;
        fileInput.accept = 'image/*';
        fileInput.style.cssText = 'display:block;margin:4px 0 12px;font-size:0.85em;width:100%';
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            await this.saveFile(await file.arrayBuffer(), file.name);
        });

        // ── Option C: vault path ────────────────────────────────────────
        contentEl.createEl('p', { text: 'Or paste a vault-relative path (file already in vault):', cls: 'ft-modal-label' });
        const pathInput = contentEl.createEl('input', { type: 'text', placeholder: `${this.photosFolder}/name.jpg` }) as HTMLInputElement;
        pathInput.style.cssText = 'display:block;width:100%;margin-bottom:6px';
        pathInput.value = this.person.avatar ?? '';
        const savePathBtn = contentEl.createEl('button', { text: 'Save path', cls: 'ft-modal-btn' });
        savePathBtn.addEventListener('click', async () => {
            await this.obsApp.fileManager.processFrontMatter(this.person.file, (fm) => { fm.avatar = pathInput.value.trim() || null; });
            this.close(); this.onDone();
        });
        pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') savePathBtn.click(); });

        if (this.person.avatar) {
            const clear = contentEl.createEl('button', { text: 'Remove photo', cls: 'ft-modal-btn ft-modal-btn-danger' });
            clear.addEventListener('click', async () => {
                await this.obsApp.fileManager.processFrontMatter(this.person.file, (fm) => { fm.avatar = null; });
                this.close(); this.onDone();
            });
        }
    }

    private async saveFile(buffer: ArrayBuffer, filename: string) {
        const ext = (filename.split('.').pop() ?? 'jpg').toLowerCase();
        const folderPath = this.photosFolder;
        const targetPath = `${folderPath}/${this.person.name}.${ext}`;
        try {
            if (!this.obsApp.vault.getAbstractFileByPath(folderPath)) {
                await this.obsApp.vault.createFolder(folderPath);
            }
            const existing = this.obsApp.vault.getAbstractFileByPath(targetPath);
            if (existing instanceof TFile) {
                await this.obsApp.vault.modifyBinary(existing, buffer);
            } else {
                await this.obsApp.vault.createBinary(targetPath, buffer);
            }
            await this.obsApp.fileManager.processFrontMatter(this.person.file, (fm) => { fm.avatar = targetPath; });
            this.close();
            this.onDone();
        } catch (err) {
            console.error('[PeopleTree] Avatar-Upload:', err);
        }
    }

    onClose() { this.contentEl.empty(); }
}

// ── Add Person Modal ──────────────────────────────────────────────────────

class AddPersonModal extends Modal {
    constructor(
        private readonly obsApp: App,
        private readonly relation: 'none' | 'parent' | 'child',
        private readonly relPerson: Person | null,
        private readonly personFolder: string,
        private readonly onDone: () => void,
        private readonly existingPersons: Map<string, Person> = new Map(),
    ) { super(obsApp); }

    onOpen() {
        const { contentEl } = this;
        const titles: Record<string, string> = {
            none: 'Add person',
            parent: `Add parent for ${this.relPerson?.name}`,
            child: `Add child for ${this.relPerson?.name}`,
        };
        contentEl.createEl('h3', { text: titles[this.relation] });

        // ── Unlinked persons from vault ───────────────────────────────────
        const unlinked = this.getUnlinkedPersons();
        if (unlinked.length) {
            contentEl.createEl('p', { cls: 'ft-modal-label', text: 'Existing persons not yet linked:' });
            const grid = contentEl.createDiv({ cls: 'ft-suggest-grid' });
            for (const name of unlinked) {
                const chip = grid.createEl('button', { cls: 'ft-suggest-chip', text: name });
                chip.addEventListener('click', async () => {
                    await this.link(name);
                });
            }
            contentEl.createEl('p', { cls: 'ft-modal-divider', text: '— or create new —' });
        }

        // ── Create new person ─────────────────────────────────────────────
        contentEl.createEl('label', { text: 'Name', cls: 'ft-modal-label' });
        const nameInput = contentEl.createEl('input', { type: 'text', placeholder: 'Full name' }) as HTMLInputElement;
        nameInput.style.cssText = 'display:block;width:100%;margin-bottom:12px';

        contentEl.createEl('label', { text: 'Born (optional)', cls: 'ft-modal-label' });
        const bornInput = contentEl.createEl('input', { type: 'text', placeholder: 'e.g. 01.01.1970' }) as HTMLInputElement;
        bornInput.style.cssText = 'display:block;width:100%;margin-bottom:16px';

        // Live-filter unlinked list while typing
        if (unlinked.length) {
            nameInput.addEventListener('input', () => {
                const q = nameInput.value.trim().toLowerCase();
                grid.querySelectorAll<HTMLElement>('.ft-suggest-chip').forEach(chip => {
                    chip.style.display = (!q || chip.textContent!.toLowerCase().includes(q)) ? '' : 'none';
                });
            });
        }

        const btn = contentEl.createEl('button', { text: 'Create', cls: 'ft-modal-btn mod-cta' });
        btn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }
            await this.create(name, bornInput.value.trim());
        });
        nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
        nameInput.focus();
    }

    private getUnlinkedPersons(): string[] {
        if (this.relation === 'none' || !this.relPerson) return [];
        const exclude = new Set<string>([this.relPerson.name]);
        if (this.relation === 'child') this.relPerson.children.forEach(n => exclude.add(n));
        if (this.relation === 'parent') this.relPerson.parents.forEach(n => exclude.add(n));
        // Only persons that exist in vault but are NOT on the board yet
        const result: string[] = [];
        for (const file of this.obsApp.vault.getMarkdownFiles()) {
            const fm = this.obsApp.metadataCache.getFileCache(file)?.frontmatter;
            if (!fm || fm.type !== 'person') continue;
            const name = (fm.name as string) || file.basename;
            if (!this.existingPersons.has(name) && !exclude.has(name)) result.push(name);
        }
        return result.sort();
    }

    private async link(name: string) {
        if (this.relPerson) {
            await this.obsApp.fileManager.processFrontMatter(this.relPerson.file, (fm) => {
                const key = this.relation === 'child' ? 'children' : 'parents';
                const existing = toArray(fm[key]);
                if (!existing.includes(name)) fm[key] = [...existing, name];
            });
            // Also update the other side
            const other = this.existingPersons.get(name);
            if (other) {
                await this.obsApp.fileManager.processFrontMatter(other.file, (fm) => {
                    const key = this.relation === 'child' ? 'parents' : 'children';
                    const existing = toArray(fm[key]);
                    if (!existing.includes(this.relPerson!.name)) fm[key] = [...existing, this.relPerson!.name];
                });
            }
        }
        this.close();
        this.onDone();
    }

    private async create(name: string, born: string) {
        const folder = this.personFolder?.trim() || '';
        const path = folder ? `${folder}/${name}.md` : `${name}.md`;
        if (folder && !this.obsApp.vault.getAbstractFileByPath(folder)) {
            await this.obsApp.vault.createFolder(folder);
        }
        let content = `---\ntype: person\nname: ${name}\nborn: ${born}\ndied: \n`;
        if (this.relation === 'child' && this.relPerson) {
            content += `parents:\n  - ${this.relPerson.name}\n`;
        } else if (this.relation === 'parent' && this.relPerson) {
            content += `children:\n  - ${this.relPerson.name}\n`;
        }
        content += `spouse: \nchildren: \n---\n`;
        if (!this.obsApp.vault.getAbstractFileByPath(path)) {
            await this.obsApp.vault.create(path, content);
        }
        if (this.relPerson) {
            await this.obsApp.fileManager.processFrontMatter(this.relPerson.file, (fm) => {
                const key = this.relation === 'child' ? 'children' : 'parents';
                const existing = toArray(fm[key]);
                if (!existing.includes(name)) fm[key] = [...existing, name];
            });
        }
        this.close();
        this.onDone();
    }

    onClose() { this.contentEl.empty(); }
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

function canvasRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
