// Desktop entry: the TS plugin handles script files, and the workspace's own assign-gingerly can be used.
import type * as vscode from 'vscode';
import { activateWith } from './extension.ts';
import { loadProjectTree } from '../../ts-plugin/src/projectTree.ts';

export function activate(context: vscode.ExtensionContext): void {
    activateWith(context, {
        tsPluginAvailable: true,
        loadWorkspaceTree: async (folder, log) => {
            const engine = await loadProjectTree(folder, log);
            return engine && { ...engine, origin: 'workspace' };
        },
    });
}
