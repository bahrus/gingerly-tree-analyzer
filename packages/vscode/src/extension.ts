// The VS Code side: diagnostics and hovers for tree`…` templates in Markdown and HTML (and in
// script files where the TS plugin can't run: VS Code for the Web, or the native TypeScript 7
// preview). On desktop, .js/.ts files are left to the TS plugin, so nothing is reported twice.

import * as vscode from 'vscode';
import ts from 'typescript';
import * as bundledTree from 'assign-gingerly/DX/tree.js';
import {
    analyzeDocument, hoverInDocument, DEFAULT_TAGS,
    type DocumentAnalysis, type DocumentKind, type Finding, type TreeEngine, type TreeModule,
} from 'gingerly-tree-analyzer-core';

declare const BUNDLED_VERSION: string;

export interface Platform {
    /** Whether tsserver plugins can run (desktop) */
    tsPluginAvailable: boolean;
    /** The workspace's own assign-gingerly (desktop, trusted workspaces) */
    loadWorkspaceTree?(folder: string, log: (message: string) => void): Promise<TreeEngine | undefined>;
}

const PLUGIN_NAME = 'gingerly-tree-ts-plugin';
const SCRIPT_KINDS: Record<string, DocumentKind> = { javascript: 'js', javascriptreact: 'jsx', typescript: 'ts', typescriptreact: 'tsx' };
const SELECTOR: vscode.DocumentSelector = ['markdown', 'html', ...Object.keys(SCRIPT_KINDS)].map(language => ({ language }));

export function activateWith(context: vscode.ExtensionContext, platform: Platform): void {
    const output = vscode.window.createOutputChannel('Gingerly Tree', { log: true });
    const log = (message: string) => output.info(message);
    const bundled: TreeEngine = { tree: bundledTree as TreeModule, version: BUNDLED_VERSION, origin: 'bundled' };
    let engine = bundled;
    const collection = vscode.languages.createDiagnosticCollection('gingerly-tree');
    const settings = () => vscode.workspace.getConfiguration('gingerlyTree');
    const tags = () => settings().get<string[]>('tags') ?? DEFAULT_TAGS;
    const pluginHandlesScripts = () => platform.tsPluginAvailable
        && !vscode.workspace.getConfiguration('typescript').get<boolean>('experimental.useTsgo');

    const kindOf = (document: vscode.TextDocument): DocumentKind | undefined => {
        const { languageId } = document;
        if (languageId === 'markdown' || languageId === 'html') return languageId;
        return pluginHandlesScripts() ? undefined : SCRIPT_KINDS[languageId];
    };

    // Analyses by document; a new generation (settings or engine changed) invalidates them all
    let generation = 0;
    const cache = new WeakMap<vscode.TextDocument, { version: number; generation: number; analysis: DocumentAnalysis }>();
    const analysisOf = (document: vscode.TextDocument): DocumentAnalysis | undefined => {
        const kind = kindOf(document);
        if (!kind) return undefined;
        const cached = cache.get(document);
        if (cached && cached.version === document.version && cached.generation === generation) return cached.analysis;
        const analysis = analyzeDocument(ts, document.getText(), kind, { engine, tags: tags() }, document.uri.path);
        cache.set(document, { version: document.version, generation, analysis });
        return analysis;
    };

    const refresh = (document: vscode.TextDocument) => {
        try {
            const analysis = analysisOf(document);
            if (!analysis) {
                collection.delete(document.uri);
                return;
            }
            collection.set(document.uri, analysis.findings.map(finding => toDiagnostic(document, finding)));
        } catch (error) {
            log(`analysis failed for ${document.uri}: ${error instanceof Error ? error.stack : error}`);
        }
    };
    const refreshAll = () => {
        generation++;
        for (const document of vscode.workspace.textDocuments) refresh(document);
    };

    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const refreshSoon = (document: vscode.TextDocument) => {
        const key = document.uri.toString();
        clearTimeout(pending.get(key));
        pending.set(key, setTimeout(() => {
            pending.delete(key);
            refresh(document);
        }, 250));
    };

    context.subscriptions.push(
        output,
        collection,
        vscode.workspace.onDidOpenTextDocument(refresh),
        vscode.workspace.onDidChangeTextDocument(event => refreshSoon(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => collection.delete(document.uri)),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('gingerlyTree') || event.affectsConfiguration('typescript.experimental.useTsgo')) {
                configurePlugin();
                refreshAll();
            }
        }),
        vscode.languages.registerHoverProvider(SELECTOR, {
            provideHover(document, position) {
                const analysis = analysisOf(document);
                const hover = analysis && hoverInDocument(ts, analysis, document.offsetAt(position));
                if (!hover) return undefined;
                const range = new vscode.Range(document.positionAt(hover.start), document.positionAt(hover.start + hover.length));
                return new vscode.Hover(new vscode.MarkdownString(hover.markdown), range);
            },
        }),
    );

    // The tags setting, for the TS plugin too
    async function configurePlugin() {
        if (!platform.tsPluginAvailable) return;
        try {
            const extension = vscode.extensions.getExtension('vscode.typescript-language-features');
            const api = (await extension?.activate())?.getAPI?.(0);
            api?.configurePlugin(PLUGIN_NAME, { tags: tags() });
        } catch (error) {
            log(`couldn't configure the TypeScript plugin: ${error}`);
        }
    }

    // The workspace's own assign-gingerly, in trusted workspaces
    async function useWorkspaceTree() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!platform.loadWorkspaceTree || !folder || folder.uri.scheme !== 'file' || !vscode.workspace.isTrusted) return;
        try {
            const workspaceEngine = await platform.loadWorkspaceTree(folder.uri.fsPath, log);
            if (!workspaceEngine) return;
            engine = workspaceEngine;
            log(`using assign-gingerly ${engine.version} (${engine.origin})`);
            refreshAll();
        } catch (error) {
            log(`couldn't load the workspace's assign-gingerly: ${error}`);
        }
    }
    context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(useWorkspaceTree));

    log(`activated (assign-gingerly ${engine.version}, ${engine.origin}; script files: ${pluginHandlesScripts() ? 'TypeScript plugin' : 'this extension'})`);
    configurePlugin();
    refreshAll();
    useWorkspaceTree();
}

function toDiagnostic(document: vscode.TextDocument, finding: Finding): vscode.Diagnostic {
    const range = new vscode.Range(document.positionAt(finding.start), document.positionAt(finding.start + finding.length));
    const severity = finding.severity === 'error' ? vscode.DiagnosticSeverity.Error
        : finding.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Hint;
    const diagnostic = new vscode.Diagnostic(range, finding.message, severity);
    diagnostic.source = 'gingerly-tree';
    diagnostic.code = finding.code;
    return diagnostic;
}
