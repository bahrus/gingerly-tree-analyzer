// VS Code for the Web entry: no TS plugin (this extension covers script files too), bundled assign-gingerly only.
import type * as vscode from 'vscode';
import { activateWith } from './extension.ts';

export function activate(context: vscode.ExtensionContext): void {
    activateWith(context, { tsPluginAvailable: false });
}
