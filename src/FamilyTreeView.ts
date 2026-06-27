import { App, ItemView, TFile, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_FAMILY_TREE = 'family-tree-view';

const NODE_W = 170;
const NODE_H = 70;
const H_GAP = 50;
const V_GAP = 90;

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
}

export class FamilyTreeView extends ItemView {
    private persons: Map<string, Person> = new Map();

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

    // ── Daten laden ────────────────────────────────────────────────────────

    private async loadPersons() {
        this.persons.clear();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!fm || fm.type !== 'person') continue;

            const name = (fm.name as string) || file.basename;
            this.persons.set(name, {
                id: name,
                name,
                born: fm.born ?? '',
                died: fm.died ?? '',
                parents: toArray(fm.parents),
                spouse: fm.spouse ?? '',
                children: toArray(fm.children),
                file,
                generation: -1,
                col: 0,
            });
        }
    }

    // ── Layout ─────────────────────────────────────────────────────────────

    private assignGenerations() {
        for (const p of this.persons.values()) {
            if (!p.parents.some(n => this.persons.has(n))) p.generation = 0;
        }
        let changed = true;
        while (changed) {
            changed = false;
            for (const p of this.persons.values()) {
                if (p.generation < 0) continue;
                for (const cName of p.children) {
                    const c = this.persons.get(cName);
                    if (c && c.generation < p.generation + 1) {
                        c.generation = p.generation + 1;
                        changed = true;
                    }
                }
            }
        }
        for (const p of this.persons.values()) if (p.generation < 0) p.generation = 0;
    }

    private assignColumns() {
        const byGen = this.byGeneration();
        for (const persons of byGen.values()) {
            // Spouses nebeneinander
            const placed = new Set<string>();
            const ordered: Person[] = [];
            for (const p of persons) {
                if (placed.has(p.name)) continue;
                ordered.push(p);
                placed.add(p.name);
                if (p.spouse) {
                    const sp = this.persons.get(p.spouse);
                    if (sp && !placed.has(sp.name)) {
                        ordered.push(sp);
                        placed.add(sp.name);
                    }
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

    // ── Render ─────────────────────────────────────────────────────────────

    async render() {
        await this.loadPersons();
        this.assignGenerations();
        this.assignColumns();

        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();

        if (this.persons.size === 0) {
            root.createEl('p', {
                text: 'Keine Personen gefunden. Notizen mit type: person im Frontmatter anlegen.',
                cls: 'ft-empty'
            });
            return;
        }

        const byGen = this.byGeneration();
        const maxGen = Math.max(...byGen.keys());
        const maxCols = Math.max(...[...byGen.values()].map(g => g.length));

        const totalW = maxCols * (NODE_W + H_GAP) + H_GAP;
        const totalH = (maxGen + 1) * (NODE_H + V_GAP) + V_GAP;

        // Wrapper für relative Positionierung
        const canvas = root.createDiv({ cls: 'ft-canvas' });
        canvas.style.width = totalW + 'px';
        canvas.style.height = totalH + 'px';

        // SVG für Verbindungslinien
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(totalW));
        svg.setAttribute('height', String(totalH));
        svg.classList.add('ft-svg');
        canvas.appendChild(svg);

        // Positionen berechnen und Nodes rendern
        const pos: Map<string, { x: number; y: number }> = new Map();

        for (const [gen, persons] of byGen) {
            const count = persons.length;
            const rowW = count * NODE_W + (count - 1) * H_GAP;
            const startX = (totalW - rowW) / 2;

            persons.forEach((person, i) => {
                const x = startX + i * (NODE_W + H_GAP);
                const y = V_GAP / 2 + gen * (NODE_H + V_GAP);
                pos.set(person.name, { x, y });
                this.renderNode(canvas, person, x, y);
            });
        }

        // Linien zeichnen
        for (const person of this.persons.values()) {
            const cp = pos.get(person.name);
            if (!cp) continue;
            for (const parentName of person.parents) {
                const pp = pos.get(parentName);
                if (!pp) continue;
                this.drawLine(svg,
                    pp.x + NODE_W / 2, pp.y + NODE_H,
                    cp.x + NODE_W / 2, cp.y
                );
            }
            // Ehepartner-Linie (gestrichelt)
            if (person.spouse) {
                const sp = pos.get(person.spouse);
                if (sp && person.name < person.spouse) { // nur einmal zeichnen
                    this.drawSpouseLine(svg,
                        pos.get(person.name)!.x + NODE_W, pos.get(person.name)!.y + NODE_H / 2,
                        sp.x, sp.y + NODE_H / 2
                    );
                }
            }
        }
    }

    // ── Node rendern ───────────────────────────────────────────────────────

    private renderNode(parent: HTMLElement, person: Person, x: number, y: number) {
        const node = parent.createDiv({ cls: 'ft-node' });
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        node.style.width = NODE_W + 'px';
        node.style.height = NODE_H + 'px';

        // Name — klickbar → Notiz öffnen
        const nameEl = node.createDiv({ cls: 'ft-name', text: person.name });
        nameEl.title = 'Klick: Notiz öffnen  |  Doppelklick: Name bearbeiten';
        nameEl.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).tagName === 'INPUT') return;
            this.app.workspace.openLinkText(person.file.path, '');
        });
        this.makeEditable(nameEl, person, 'name', person.name);

        // Daten
        const datesEl = node.createDiv({ cls: 'ft-dates' });
        const bornPart = person.born ? `* ${person.born}` : '* ?';
        const diedPart = person.died ? ` † ${person.died}` : '';
        datesEl.textContent = bornPart + diedPart;
        datesEl.title = 'Doppelklick: Geburtsdatum bearbeiten';
        this.makeEditable(datesEl, person, 'born', person.born, (val) => `* ${val || '?'}${person.died ? ` † ${person.died}` : ''}`);

        // Bearbeiten-Button
        const editBtn = node.createEl('button', { cls: 'ft-edit-btn', text: '✎' });
        editBtn.title = 'Person bearbeiten';
        editBtn.addEventListener('click', () => this.openEditPanel(person));
    }

    // ── Inline-Editing ─────────────────────────────────────────────────────

    private makeEditable(
        el: HTMLElement,
        person: Person,
        field: keyof Person,
        rawValue: string,
        display?: (val: string) => string
    ) {
        el.addEventListener('dblclick', async () => {
            if (el.querySelector('input')) return;

            const input = createEl('input', { type: 'text', value: rawValue });
            input.addClass('ft-input');
            el.empty();
            el.appendChild(input);
            input.focus();
            input.select();

            const save = async () => {
                const newVal = input.value.trim();
                el.textContent = display ? display(newVal) : newVal;
                if (newVal !== rawValue) {
                    (person as Record<string, unknown>)[field] = newVal;
                    await this.app.fileManager.processFrontMatter(person.file, (fm) => {
                        fm[field as string] = newVal || null;
                    });
                }
            };

            input.addEventListener('blur', save);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); save(); }
                if (e.key === 'Escape') {
                    el.textContent = display ? display(rawValue) : rawValue;
                }
            });
        });
    }

    // ── Edit-Panel (für Beziehungen) ───────────────────────────────────────

    private openEditPanel(person: Person) {
        // Simples Modal zum Bearbeiten von parents / children / spouse
        const modal = this.containerEl.createDiv({ cls: 'ft-modal' });
        const box = modal.createDiv({ cls: 'ft-modal-box' });

        box.createEl('h3', { text: `✎ ${person.name}` });

        const fields: { label: string; field: keyof Person; isArray: boolean }[] = [
            { label: 'Geburtsdatum', field: 'born', isArray: false },
            { label: 'Sterbedatum', field: 'died', isArray: false },
            { label: 'Ehepartner', field: 'spouse', isArray: false },
            { label: 'Eltern (kommagetrennt)', field: 'parents', isArray: true },
            { label: 'Kinder (kommagetrennt)', field: 'children', isArray: true },
        ];

        const inputs: Map<string, HTMLInputElement> = new Map();

        for (const f of fields) {
            const row = box.createDiv({ cls: 'ft-modal-row' });
            row.createEl('label', { text: f.label });
            const val = f.isArray
                ? (person[f.field] as string[]).join(', ')
                : (person[f.field] as string) || '';
            const input = row.createEl('input', { type: 'text', value: val, cls: 'ft-modal-input' });
            inputs.set(f.field, input);
        }

        const btnRow = box.createDiv({ cls: 'ft-modal-btns' });

        const saveBtn = btnRow.createEl('button', { text: 'Speichern', cls: 'ft-btn-save' });
        saveBtn.addEventListener('click', async () => {
            await this.app.fileManager.processFrontMatter(person.file, (fm) => {
                for (const f of fields) {
                    const input = inputs.get(f.field)!;
                    if (f.isArray) {
                        fm[f.field as string] = input.value.split(',').map(s => s.trim()).filter(Boolean);
                    } else {
                        fm[f.field as string] = input.value.trim() || null;
                    }
                }
            });
            modal.remove();
            await this.render();
        });

        const cancelBtn = btnRow.createEl('button', { text: 'Abbrechen', cls: 'ft-btn-cancel' });
        cancelBtn.addEventListener('click', () => modal.remove());

        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        document.body.appendChild(modal);
    }

    // ── SVG-Linien ─────────────────────────────────────────────────────────

    private drawLine(svg: SVGElement, x1: number, y1: number, x2: number, y2: number) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const my = (y1 + y2) / 2;
        path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`);
        path.setAttribute('stroke', 'var(--color-accent, #7c3aed)');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
    }

    private drawSpouseLine(svg: SVGElement, x1: number, y1: number, x2: number, y2: number) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', '#e879f9');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '5,4');
        svg.appendChild(line);
    }
}

function toArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string') return [val];
    return [];
}
