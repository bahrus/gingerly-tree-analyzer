// A TypeScript language service plugin for tree`…` templates in .js/.ts files: diagnostics (the
// tag's errors, and checks against types), hovers showing the produced notation, and a quick fix
// for a missing import. Loaded by tsserver (VS Code activates it through the extension's
// `typescriptServerPlugins`), which passes in its own TypeScript module.

import type ts from 'typescript';
import * as bundledTree from 'assign-gingerly/DX/tree.js';
import {
    analyzeSourceFile, typeChecks, hoverAt, isPathProxy, Codes, DEFAULT_TAGS,
    type FileAnalysis, type Finding, type TreeEngine, type TreeModule,
} from 'gingerly-tree-analyzer-core';
import { loadProjectTree } from './projectTree.ts';

declare const BUNDLED_VERSION: string;

type Typescript = typeof ts;

/** Settings, from the VS Code extension (configurePlugin) or tsconfig's plugin entry. */
interface PluginConfig {
    /** Tag names analyzed without an import (default: tree, DX.tree) */
    tags?: string[];
}

const SOURCE = 'gingerly-tree';
const FIX_NAME = 'gingerlyTreeImport';

function init({ typescript }: { typescript: Typescript }): ts.server.PluginModule {
    const ts = typescript;
    let config: PluginConfig = {};

    function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
        const ls = info.languageService;
        const log = (message: string) => info.project.projectService.logger.info(`[gingerly-tree] ${message}`);
        config = { ...config, ...(info.config as PluginConfig) };
        let engine: TreeEngine = { tree: bundledTree as TreeModule, version: BUNDLED_VERSION, origin: 'bundled' };

        // Prefer the project's own assign-gingerly, when it has analyzeTree
        loadProjectTree(info.project.getCurrentDirectory(), log).then(projectEngine => {
            if (!projectEngine) return;
            engine = projectEngine;
            cache = new WeakMap();
            log(`using assign-gingerly ${engine.version} (${engine.origin})`);
            info.project.refreshDiagnostics();
        }, error => log(`couldn't load the project's assign-gingerly: ${error}`));

        // One analysis per program and file
        let cache = new WeakMap<ts.Program, Map<string, { file: FileAnalysis; findings: Finding[] }>>();
        const analyze = (fileName: string) => {
            const program = ls.getProgram();
            const sf = program?.getSourceFile(fileName);
            if (!program || !sf) return undefined;
            let files = cache.get(program);
            if (!files) cache.set(program, files = new Map());
            let entry = files.get(fileName);
            if (!entry) {
                const checker = program.getTypeChecker();
                const file = analyzeSourceFile(ts, sf, {
                    engine,
                    tags: config.tags ?? DEFAULT_TAGS,
                    reportMissingImport: true,
                    isPathRoot: id => isPathProxy(checker, id),
                });
                entry = { file, findings: [...file.findings, ...typeChecks(ts, checker, file)] };
                files.set(fileName, entry);
            }
            return entry;
        };
        const safely = <T>(what: string, fallback: T, fn: () => T): T => {
            try {
                return fn();
            } catch (error) {
                log(`${what} failed: ${error instanceof Error ? error.stack : error}`);
                return fallback;
            }
        };
        const toDiagnostic = (sf: ts.SourceFile, finding: Finding): ts.Diagnostic => ({
            file: sf,
            start: finding.start,
            length: finding.length,
            messageText: finding.message,
            category: finding.severity === 'error' ? ts.DiagnosticCategory.Error
                : finding.severity === 'warning' ? ts.DiagnosticCategory.Warning
                : ts.DiagnosticCategory.Suggestion,
            code: finding.code,
            source: SOURCE,
        });

        const proxy: ts.LanguageService = Object.create(null);
        for (const key of Object.keys(ls) as (keyof ts.LanguageService)[]) {
            const method = ls[key];
            (proxy as any)[key] = typeof method === 'function' ? (...args: unknown[]) => (method as Function).apply(ls, args) : method;
        }

        proxy.getSemanticDiagnostics = fileName => {
            const prior = ls.getSemanticDiagnostics(fileName);
            return safely('diagnostics', prior, () => {
                const entry = analyze(fileName);
                if (!entry) return prior;
                const ours = entry.findings.filter(finding => finding.severity !== 'suggestion').map(finding => toDiagnostic(entry.file.sf, finding));
                return [...prior, ...ours];
            });
        };

        proxy.getSuggestionDiagnostics = fileName => {
            const prior = ls.getSuggestionDiagnostics(fileName);
            return safely('suggestions', prior, () => {
                const entry = analyze(fileName);
                if (!entry) return prior;
                const ours = entry.findings.filter(finding => finding.severity === 'suggestion').map(finding => toDiagnostic(entry.file.sf, finding));
                return [...prior, ...ours] as ts.DiagnosticWithLocation[];
            });
        };

        proxy.getQuickInfoAtPosition = (fileName, position, ...rest) => {
            const prior = ls.getQuickInfoAtPosition(fileName, position, ...rest);
            return safely('hover', prior, () => {
                const entry = analyze(fileName);
                const hover = entry && hoverAt(ts, entry.file, position);
                if (!hover) return prior;
                const documentation: ts.SymbolDisplayPart[] = [{ kind: 'text', text: hover.markdown }];
                if (prior) {
                    return { ...prior, documentation: [...documentation, { kind: 'lineBreak', text: '\n\n' }, ...(prior.documentation ?? [])] };
                }
                return {
                    kind: ts.ScriptElementKind.unknown,
                    kindModifiers: '',
                    textSpan: { start: hover.start, length: hover.length },
                    documentation,
                };
            });
        };

        proxy.getSupportedCodeFixes = fileName => [...ls.getSupportedCodeFixes(fileName), String(Codes.notImported)];

        proxy.getCodeFixesAtPosition = (fileName, start, end, errorCodes, formatOptions, preferences) => {
            const prior = ls.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions, preferences);
            if (!errorCodes.includes(Codes.notImported)) return prior;
            return safely('code fixes', prior, () => {
                const entry = analyze(fileName);
                const finding = entry?.findings.find(f => f.code === Codes.notImported && f.start <= end && start <= f.start + f.length);
                if (!entry || !finding) return prior;
                const tag = entry.file.sf.text.slice(finding.start, finding.start + finding.length);
                const [namespace, member] = tag.split('.');
                const statement = member
                    ? `import * as ${namespace} from 'assign-gingerly/DX/tree.js';`
                    : `import { ${tag === 'tree' ? 'tree' : `tree as ${tag}`} } from 'assign-gingerly/DX/tree.js';`;
                const at = entry.file.imports.importInsertAt;
                const newline = entry.file.sf.text.includes('\r\n') ? '\r\n' : '\n';
                return [...prior, {
                    fixName: FIX_NAME,
                    description: `Add import from 'assign-gingerly/DX/tree.js'`,
                    changes: [{ fileName, textChanges: [{ span: { start: at, length: 0 }, newText: at > 0 ? `${newline}${statement}` : `${statement}${newline}` }] }],
                }];
            });
        };

        log(`plugin created (assign-gingerly ${engine.version}, ${engine.origin})`);
        return proxy;
    }

    return {
        create,
        onConfigurationChanged(next: PluginConfig) {
            config = { ...config, ...next };
        },
    };
}

export default init;
