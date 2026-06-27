import { App, ItemView, TFile, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_FAMILY_TREE = 'family-tree-view';

const NODE_W = 190;
const NODE_H = 72;
const H_GAP = 60;
const V_GAP = 110;

interface Person {
    id: string;
    name: string;
    born: string;
    died: string;
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

    constructor(leaf: WorkspaceLeaf, private app: App) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_FAMILY_TREE; }
    getDisplayText() { return 'Family Tree'; }
    getIcon() { return 'users'; }

    async onOpen() {
        this.containerEl.children[1].addClass('family-tree-root');
        await this.render();
        this.registerEvent(this.app.metadataCache.on('changed', () => this.render()));
    }

    async onClose() {}

    // ── Daten ─────────────────────────────────────────────────────────────

    private async loadPersons() {
        this.persons.clear();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!fm || fm.type !== 'person') continue;
            const { type: _t, name: fmName, born, died, parents, spouse, children, position: _p, ...extra } = fm;
            const name = (fmName as string) || file.basename;
            this.persons.set(name, {
                id: name, name,
                born: born ?? '', died: died ?? '',
                parents: toArray(parents), spouse: spouse ?? '',
                children: toArray(children),
                file, generation: -1, col: 0,
                extra: extra ?? {},
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

    // ── Render ────────────────────────────────────────────────────────────

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

        // Toolbar
        this.renderToolbar(root.createDiv({ cls: 'ft-toolbar' }));

        const viewport = root.createDiv({ cls: 'ft-viewport' });
        const canvas = viewport.createDiv({ cls: 'ft-canvas' });

        const byGen = this.byGeneration();
        const maxGen = Math.max(...byGen.keys());
        const maxCols = Math.max(...[...byGen.values()].map(g => g.length));
        const totalW = maxCols * (NODE_W + H_GAP) + H_GAP;
        const totalH = (maxGen + 1) * (NODE_H + V_GAP) + V_GAP;

        canvas.style.width = totalW + 'px';
        canvas.style.height = totalH + 'px';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(totalW));
        svg.setAttribute('height', String(totalH));
        svg.classList.add('ft-svg');
        canvas.appendChild(svg);

        const pos: Map<string, { x: number; y: number }> = new Map();

        for (const [gen, persons] of byGen) {
            const rowW = persons.length * NODE_W + (persons.length - 1) * H_GAP;
            const startX = (totalW - rowW) / 2;
            persons.forEach((person, i) => {
                const x = startX + i * (NODE_W + H_GAP);
                const y = V_GAP / 2 + gen * (NODE_H + V_GAP);
                pos.set(person.name, { x, y });
                this.renderNode(canvas, person, x, y);
            });
        }

        for (const person of this.persons.values()) {
            const cp = pos.get(person.name);
            if (!cp) continue;
            for (const pn of person.parents) {
                const pp = pos.get(pn);
                if (pp) this.drawLine(svg, pp.x + NODE_W / 2, pp.y + NODE_H, cp.x + NODE_W / 2, cp.y, pn, person.name, 'parent');
            }
            if (person.spouse && person.name < person.spouse) {
                const sp = pos.get(person.spouse);
                const p1 = pos.get(person.name);
                if (sp && p1) this.drawLine(svg, p1.x + NODE_W, p1.y + NODE_H / 2, sp.x, sp.y + NODE_H / 2, person.name, person.spouse, 'spouse');
            }
        }

        if (this.selectedPerson) this.applySelection(this.selectedPerson);
        this.setupZoomPan(viewport, canvas);
        this.applyTransform(canvas);
    }

    // ── Toolbar ───────────────────────────────────────────────────────────

    private renderToolbar(toolbar: HTMLElement) {
        const btn = (text: string, title: string, fn: () => void) => {
            const b = toolbar.createEl('button', { text, cls: 'ft-tb-btn', title });
            b.addEventListener('click', fn);
        };
        btn('+', 'Hineinzoomen', () => { this.zoom = Math.min(this.zoom * 1.2, 4); this.applyTransform(this.getCanvas()); });
        btn('−', 'Herauszoomen', () => { this.zoom = Math.max(this.zoom / 1.2, 0.2); this.applyTransform(this.getCanvas()); });
        btn('⌂', 'Zurücksetzen', () => { this.zoom = 1; this.panX = 0; this.panY = 0; this.applyTransform(this.getCanvas()); });
        toolbar.createEl('span', { cls: 'ft-tb-hint', text: 'Mausrad: Zoom  ·  Drag: Pan  ·  Klick: Auswahl  ·  ▼: Details' });
    }

    private getCanvas(): HTMLElement {
        return this.containerEl.querySelector('.ft-canvas') as HTMLElement;
    }

    // ── Node ──────────────────────────────────────────────────────────────

    private renderNode(parent: HTMLElement, person: Person, x: number, y: number) {
        const node = parent.createDiv({ cls: 'ft-node' });
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        node.style.width = NODE_W + 'px';
        node.dataset.person = person.name;
        if (this.expandedPersons.has(person.name)) node.addClass('expanded');

        // Header (immer sichtbar)
        const header = node.createDiv({ cls: 'ft-node-header' });
        const info = header.createDiv({ cls: 'ft-node-info' });
        const nameEl = info.createDiv({ cls: 'ft-name', text: person.name });
        this.makeEditable(nameEl, person, 'name', person.name);
        const datesEl = info.createDiv({ cls: 'ft-dates', text: formatDates(person.born, person.died) });
        this.makeEditable(datesEl, person, 'born', person.born, (v) => formatDates(v, person.died));

        const btns = header.createDiv({ cls: 'ft-node-btns' });

        // Notiz öffnen
        const openBtn = btns.createEl('button', { cls: 'ft-icon-btn', title: 'Notiz öffnen', text: '↗' });
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.workspace.openLinkText(person.file.path, '');
        });

        // Expand toggle
        const isExpanded = this.expandedPersons.has(person.name);
        const expandBtn = btns.createEl('button', { cls: 'ft-icon-btn', title: 'Details', text: isExpanded ? '▲' : '▼' });
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.expandedPersons.has(person.name)) this.expandedPersons.delete(person.name);
            else this.expandedPersons.add(person.name);
            this.render();
        });

        // Detail-Bereich (nur sichtbar wenn expanded)
        const detail = node.createDiv({ cls: 'ft-detail' });
        this.detailField(detail, person, 'Geburtsdatum', 'born', person.born, false);
        this.detailField(detail, person, 'Sterbedatum', 'died', person.died, false);
        this.detailField(detail, person, 'Ehepartner', 'spouse', person.spouse, false);
        this.detailField(detail, person, 'Eltern', 'parents', person.parents.join(', '), true);
        this.detailField(detail, person, 'Kinder', 'children', person.children.join(', '), true);

        for (const [key, val] of Object.entries(person.extra)) {
            const v = Array.isArray(val) ? (val as string[]).join(', ') : String(val ?? '');
            this.detailField(detail, person, key, key, v, Array.isArray(val));
        }

        const addRow = detail.createDiv({ cls: 'ft-add-row' });
        const addBtn = addRow.createEl('button', { cls: 'ft-add-btn', text: '+ Feld hinzufügen' });
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showAddField(addRow, person, addBtn); });

        // Klick auf Node = Auswahl
        node.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('button, input')) return;
            const already = this.selectedPerson === person.name;
            this.selectedPerson = already ? null : person.name;
            this.applySelection(this.selectedPerson);
        });
    }

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

    // ── Inline-Edit ───────────────────────────────────────────────────────

    private makeEditable(el: HTMLElement, person: Person, field: string, raw: string, display?: (v: string) => string) {
        el.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (el.querySelector('input')) return;
            this.startEdit(el, raw, async (newVal) => {
                el.textContent = display ? display(newVal) : newVal;
                if (newVal !== raw) {
                    (person as Record<string, unknown>)[field] = newVal;
                    await this.app.fileManager.processFrontMatter(person.file, (fm) => { fm[field] = newVal || null; });
                }
            }, () => { el.textContent = display ? display(raw) : raw; });
        });
    }

    private inlineEdit(el: HTMLElement, person: Person, field: string, raw: string, isArray: boolean) {
        if (el.querySelector('input')) return;
        this.startEdit(el, raw, async (newVal) => {
            el.textContent = newVal || '—';
            await this.app.fileManager.processFrontMatter(person.file, (fm) => {
                fm[field] = isArray ? newVal.split(',').map((s: string) => s.trim()).filter(Boolean) : (newVal || null);
            });
        }, () => { el.textContent = raw || '—'; });
    }

    private startEdit(el: HTMLElement, value: string, onSave: (v: string) => Promise<void>, onCancel: () => void) {
        const input = createEl('input', { type: 'text', value, cls: 'ft-inline-input' });
        el.empty();
        el.appendChild(input);
        input.focus(); input.select();
        let saved = false;
        const save = async () => { if (saved) return; saved = true; await onSave(input.value.trim()); };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { saved = true; onCancel(); }
        });
    }

    // ── Selektion + Highlighting ──────────────────────────────────────────

    private applySelection(name: string | null) {
        const canvas = this.getCanvas();
        if (!canvas) return;

        canvas.querySelectorAll<HTMLElement>('.ft-node').forEach(node => {
            node.classList.remove('selected', 'dimmed');
            if (!name) return;
            if (node.dataset.person === name) { node.classList.add('selected'); return; }
            const p = this.persons.get(node.dataset.person!);
            const s = this.persons.get(name);
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

    // ── Zoom / Pan ────────────────────────────────────────────────────────

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
        const stopPan = () => { panning = false; viewport.style.cursor = 'grab'; };
        viewport.addEventListener('mouseup', stopPan);
        viewport.addEventListener('mouseleave', stopPan);

        viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom = Math.min(Math.max(this.zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.2), 4);
            this.applyTransform(canvas);
        }, { passive: false });
    }

    private applyTransform(canvas: HTMLElement | null) {
        if (!canvas) return;
        canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }

    // ── SVG-Linien ────────────────────────────────────────────────────────

    private drawLine(svg: SVGElement, x1: number, y1: number, x2: number, y2: number, a: string, b: string, type: 'parent' | 'spouse') {
        const el = document.createElementNS('http://www.w3.org/2000/svg', type === 'spouse' ? 'line' : 'path') as SVGElement;
        el.classList.add('ft-line', `ft-line-${type}`);
        el.dataset.a = a; el.dataset.b = b;

        if (type === 'parent') {
            const my = (y1 + y2) / 2;
            (el as SVGPathElement).setAttribute('d', `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`);
            (el as SVGPathElement).setAttribute('fill', 'none');
        } else {
            (el as SVGLineElement).setAttribute('x1', String(x1)); (el as SVGLineElement).setAttribute('y1', String(y1));
            (el as SVGLineElement).setAttribute('x2', String(x2)); (el as SVGLineElement).setAttribute('y2', String(y2));
        }
        svg.appendChild(el);
    }
}

function toArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string' && val) return [val];
    return [];
}

function formatDates(born: string, died: string): string {
    return (born ? `* ${born}` : '* ?') + (died ? ` † ${died}` : '');
}
