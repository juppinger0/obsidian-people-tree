import { Plugin } from 'obsidian';
import { FamilyTreeView, VIEW_TYPE_FAMILY_TREE } from './FamilyTreeView';

export default class PeopleTreePlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_FAMILY_TREE, (leaf) => new FamilyTreeView(leaf, this.app));
        this.addRibbonIcon('users', 'People Tree öffnen', () => this.activateView());
        this.addCommand({ id: 'open-people-tree', name: 'People Tree öffnen', callback: () => this.activateView() });
    }

    onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE_FAMILY_TREE); }

    async activateView() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_FAMILY_TREE);
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE_FAMILY_TREE, active: true });
        this.app.workspace.revealLeaf(leaf);
    }
}
