import { Plugin, PluginSettingTab, App, Setting } from 'obsidian';
import { FamilyTreeView, VIEW_TYPE_FAMILY_TREE } from './FamilyTreeView';

export interface PeopleTreeSettings {
    photosFolder: string;
    personFolder: string;
}

const DEFAULT_SETTINGS: PeopleTreeSettings = {
    photosFolder: 'Attachments/Photos',
    personFolder: '',
};

export default class PeopleTreePlugin extends Plugin {
    settings: PeopleTreeSettings;

    async onload() {
        await this.loadSettings();
        this.registerView(VIEW_TYPE_FAMILY_TREE, (leaf) => new FamilyTreeView(leaf, this.app, this.settings));
        this.addRibbonIcon('users', 'Open People Tree', () => this.activateView());
        this.addCommand({ id: 'open-people-tree', name: 'Open People Tree', callback: () => this.activateView() });
        this.addSettingTab(new PeopleTreeSettingTab(this.app, this));
    }

    onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE_FAMILY_TREE); }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_FAMILY_TREE);
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE_FAMILY_TREE, active: true });
        this.app.workspace.revealLeaf(leaf);
    }
}

class PeopleTreeSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: PeopleTreePlugin) { super(app, plugin); }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'People Tree Settings' });

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
