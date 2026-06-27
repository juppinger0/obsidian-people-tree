import { Plugin, PluginSettingTab, App, Setting } from 'obsidian';
declare const activeDocument: Document;
import { FamilyTreeView, VIEW_TYPE_FAMILY_TREE } from './FamilyTreeView';

export interface PeopleTreeSettings {
    photosFolder: string;
    personFolder: string;
}

const DEFAULT_SETTINGS: PeopleTreeSettings = {
    photosFolder: 'Attachments/Photos',
    personFolder: 'People',
};

export class PeopleTreePlugin extends Plugin {
    settings: PeopleTreeSettings;
    private layoutPositions: Record<string, { x: number; y: number }> = {};

    async onload() {
        await this.loadSettings();
        this.registerView(VIEW_TYPE_FAMILY_TREE, (leaf) => new FamilyTreeView(leaf, this.app, this.settings, this));
        this.addRibbonIcon('users', 'Open People Tree', () => { void this.activateView(); });
        this.addCommand({ id: 'open', name: 'Open', callback: () => { void this.activateView(); } });
        this.addSettingTab(new PeopleTreeSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(() => this.updateFileIcons());
        this.registerEvent(this.app.metadataCache.on('resolved', () => this.updateFileIcons()));
        this.registerEvent(this.app.workspace.on('layout-change', () => this.updateFileIcons()));
        this.registerEvent(this.app.vault.on('rename', () => this.updateFileIcons()));
        this.registerEvent(this.app.vault.on('delete', () => this.updateFileIcons()));
    }

    onunload() {
        activeDocument.querySelectorAll('.pt-file-icon').forEach(el => el.remove());
    }

    updateFileIcons() {
        try {
            for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
                const container = (leaf.view as { containerEl?: HTMLElement }).containerEl;
                if (!container) continue;
                container.querySelectorAll<HTMLElement>('.nav-file-title[data-path]').forEach(titleEl => {
                    const path = titleEl.dataset.path ?? '';
                    const fm = this.app.metadataCache.getCache(path)?.frontmatter;
                    const isPerson = fm?.type === 'person' && !fm?.hidden;
                    const isHidden = fm?.type === 'person' && !!fm?.hidden;
                    const existing = titleEl.querySelector('.pt-file-icon') as HTMLElement | null;
                    if (isPerson) {
                        if (!existing) {
                            const icon = titleEl.createSpan({ cls: 'pt-file-icon', text: '👤' });
                            titleEl.insertBefore(icon, titleEl.firstChild);
                        } else existing.removeClass('pt-file-icon--hidden');
                    } else if (isHidden) {
                        if (!existing) {
                            const icon = titleEl.createSpan({ cls: 'pt-file-icon pt-file-icon--hidden', text: '👤' });
                            titleEl.insertBefore(icon, titleEl.firstChild);
                        } else existing.addClass('pt-file-icon--hidden');
                    } else if (existing) {
                        existing.remove();
                    }
                });
            }
        } catch { /* file-explorer DOM structure changed — icons silently disabled */ }
    }

    getPosition(filePath: string): { x: number; y: number } | null {
        return this.layoutPositions[filePath] ?? null;
    }

    async savePosition(filePath: string, x: number, y: number) {
        this.layoutPositions[filePath] = { x, y };
        await this.persist();
    }

    async clearPositions() {
        this.layoutPositions = {};
        await this.persist();
    }

    async loadSettings() {
        const raw = await this.loadData();
        // Migrate: old format was flat settings object, new format is { settings, positions }
        if (raw?.settings) {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings);
            this.layoutPositions = raw.positions ?? {};
        } else {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
            this.layoutPositions = {};
        }
    }

    async saveSettings() {
        await this.persist();
    }

    private async persist() {
        await this.saveData({ settings: this.settings, positions: this.layoutPositions });
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_FAMILY_TREE);
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE_FAMILY_TREE, active: true });
    }
}

export default PeopleTreePlugin;

class PeopleTreeSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: PeopleTreePlugin) { super(app, plugin); }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        new Setting(containerEl).setHeading();

        new Setting(containerEl)
            .setName('Photos folder')
            .setDesc('Vault-relative folder where uploaded photos are saved.')
            .addText(text => text
                .setPlaceholder('Attachments/Photos')
                .setValue(this.plugin.settings.photosFolder)
                .onChange(async (value) => {
                    this.plugin.settings.photosFolder = value.trim() || DEFAULT_SETTINGS.photosFolder;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Person notes folder (optional)')
            .setDesc('Limit person search to this folder. Leave empty to search the whole vault.')
            .addText(text => text
                .setPlaceholder('People')
                .setValue(this.plugin.settings.personFolder)
                .onChange(async (value) => {
                    this.plugin.settings.personFolder = value.trim();
                    await this.plugin.saveSettings();
                }));
    }
}
