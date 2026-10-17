// The built plugin (dist/index.cjs), on a real TypeScript language service with the DOM lib.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..', '..', '..');
const init = require(path.join(root, 'packages', 'ts-plugin', 'dist', 'index.cjs'));
// Virtual files live in the repo (so assign-gingerly's types resolve from node_modules)
const dir = path.join(root, '__virtual__').replace(/\\/g, '/');
// …but the plugin looks for the project's own assign-gingerly in an empty folder, so it uses the bundled one
const emptyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'gingerly-tree-'));

function service(sources: Record<string, string>, config: object = {}) {
    const files = new Map(Object.entries(sources).map(([name, text]) => [`${dir}/${name}`, text]));
    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
        allowJs: true, checkJs: true, strict: true, noEmit: true, skipLibCheck: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [],
        allowImportingTsExtensions: true,
    };
    const host: ts.LanguageServiceHost = {
        getScriptFileNames: () => [...files.keys()],
        getScriptVersion: () => '1',
        getScriptSnapshot: name => {
            const text = files.get(name) ?? (ts.sys.fileExists(name) ? ts.sys.readFile(name) : undefined);
            return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
        },
        getCurrentDirectory: () => dir,
        getCompilationSettings: () => options,
        getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
        fileExists: name => files.has(name) || ts.sys.fileExists(name),
        readFile: name => files.get(name) ?? ts.sys.readFile(name),
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
        realpath: ts.sys.realpath,
    };
    const languageService = ts.createLanguageService(host);
    const logs: string[] = [];
    const plugin = init({ typescript: ts });
    const ls: ts.LanguageService = plugin.create({
        languageService, languageServiceHost: host, config, serverHost: ts.sys,
        project: { getCurrentDirectory: () => emptyProject, projectService: { logger: { info: (m: string) => logs.push(m) } }, refreshDiagnostics() {} },
    });
    const file = (name: string) => `${dir}/${name}`;
    const text = (name: string) => files.get(file(name))!;
    return { ls, plugin, logs, file, text };
}

const ours = (diagnostics: readonly ts.Diagnostic[]) => diagnostics.filter(d => d.source === 'gingerly-tree');
const IMPORT = `import { tree } from 'assign-gingerly/DX/tree.js';\n`;

test('the tag\'s errors are semantic diagnostics, at the construct', () => {
    const { ls, file, text } = service({ 'a.ts': `${IMPORT}export const a = tree\`<ul><li></ul>\`;` });
    const [error] = ours(ls.getSemanticDiagnostics(file('a.ts')));
    assert.equal(error.code, 9800);
    assert.equal(error.category, ts.DiagnosticCategory.Error);
    assert.equal(error.messageText, "</ul> doesn't match <li>");
    assert.equal(error.start, text('a.ts').indexOf('</ul>'));
});

test('TypeScript\'s own diagnostics are kept', () => {
    const { ls, file } = service({ 'a.ts': `${IMPORT}const n: number = 'x';\nexport const a = tree\`<b></i>\`;` });
    const all = ls.getSemanticDiagnostics(file('a.ts'));
    assert.ok(all.some(d => d.code === 2322), 'the type error is still there');
    assert.equal(ours(all).length, 1);
});

test('.prop is checked against the element\'s type', () => {
    const { ls, file, text } = service({
        'a.ts': `${IMPORT}export const a = tree\`<div>
  <input .value=\${'?.v'} .valu=\${'?.v'} .style.color=\${'?.c'}>
  <x-thing .anything=\${'?.v'}></x-thing>
</div>\`;`,
    });
    const warnings = ours(ls.getSemanticDiagnostics(file('a.ts')));
    assert.deepEqual(warnings.map(w => [w.code, w.messageText]), [[9802, "Property 'valu' doesn't exist on <input> (HTMLInputElement)."]]);
    assert.equal(warnings[0].start, text('a.ts').indexOf('valu='));
    assert.equal(warnings[0].category, ts.DiagnosticCategory.Warning);
});

test('@event names that aren\'t standard are suggestions, not warnings', () => {
    const { ls, file } = service({ 'a.ts': `${IMPORT}export const a = tree\`<div><button @click=\${'go'} @clik=\${'go'}>Go</button></div>\`;` });
    assert.equal(ours(ls.getSemanticDiagnostics(file('a.ts'))).length, 0);
    const suggestions = ours(ls.getSuggestionDiagnostics(file('a.ts')));
    assert.deepEqual(suggestions.map(s => [s.code, s.messageText]), [[9803, "'clik' isn't a standard event of <button>. (Fine for a custom event.)"]]);
});

test('ish=${…} must be a class or a name', () => {
    const { ls, file } = service({
        'a.ts': `${IMPORT}class Manager {}\nexport const a = tree\`<div>
  <section ish=\${Manager}></section><section ish=\${'registered-name'}></section><section ish=\${42}></section>
</div>\`;`,
    });
    const warnings = ours(ls.getSemanticDiagnostics(file('a.ts')));
    assert.deepEqual(warnings.map(w => [w.code, w.messageText]), [[9804, 'ish expects a manager class or a registered name, not 42.']]);
});

test('a tag that isn\'t imported: a warning, and a quick fix that adds the import', () => {
    const { ls, file, text } = service({ 'a.ts': `import { paths } from 'assign-gingerly/DX/paths.js';\nexport const a = tree\`<b>x</b>\`;` });
    const [warning] = ours(ls.getSemanticDiagnostics(file('a.ts'))).filter(d => d.code === 9801);
    assert.ok(warning, 'a not-imported warning');
    assert.ok(ls.getSupportedCodeFixes(file('a.ts')).includes('9801'));
    const fixes = ls.getCodeFixesAtPosition(file('a.ts'), warning.start!, warning.start! + warning.length!, [9801], {}, {});
    const fix = fixes.find(f => f.fixName === 'gingerlyTreeImport')!;
    const [change] = fix.changes[0].textChanges;
    const fixed = text('a.ts').slice(0, change.span.start) + change.newText + text('a.ts').slice(change.span.start);
    assert.equal(fixed.split('\n')[1], "import { tree } from 'assign-gingerly/DX/tree.js';");
});

test('paths are recognized by type (PathProxy), not just by a paths() call in the file', () => {
    const { ls, file, text } = service({
        'a.ts': `${IMPORT}import { paths } from 'assign-gingerly/DX/paths.js';
interface Launch { name: string; crew: { id: string }[] }
const makePaths = () => paths<Launch>();
const q = makePaths();
export const a = tree\`<p>\${q.name}</p>\`;`,
    });
    const info = ls.getQuickInfoAtPosition(file('a.ts'), text('a.ts').indexOf('<p>'))!;
    assert.match(info.documentation![0].text, /\['p', \{ textContent: '\?\.name' \}\]/);
});

test('hover: the notation on the template; on the tag, together with TypeScript\'s own info', () => {
    const { ls, file, text } = service({ 'a.ts': `${IMPORT}export const a = tree\`<h3 class="title">\${'?.name'}</h3>\`;` });
    const onMarkup = ls.getQuickInfoAtPosition(file('a.ts'), text('a.ts').indexOf('<h3'))!;
    assert.match(onMarkup.documentation![0].text, /\['h3', \{ 'class :=': 'title', textContent: '\?\.name' \}\]/);
    const onTag = ls.getQuickInfoAtPosition(file('a.ts'), text('a.ts').indexOf('tree`'))!;
    assert.match(onTag.documentation![0].text, /produces/);
    assert.ok(onTag.displayParts!.some(part => part.text === 'tree'), "TypeScript's own signature is kept");
    const onClass = ls.getQuickInfoAtPosition(file('a.ts'), text('a.ts').indexOf('class'))!;
    assert.match(onClass.documentation![0].text, /an \*\*attribute\*\*/);
    assert.match(onClass.documentation![0].text, /assign-gingerly [\d.]+ \(bundled\)/);
});

test('JavaScript files (checkJs) work the same', () => {
    const { ls, file } = service({ 'a.js': `${IMPORT}export const a = tree\`<input .valu=\${'?.v'}>\`;` });
    assert.deepEqual(ours(ls.getSemanticDiagnostics(file('a.js'))).map(d => d.code), [9802]);
});

test('the tags setting (from the extension) adds names', () => {
    const { ls, plugin, file } = service({ 'a.ts': `export const a = h\`<b></i>\`;\ndeclare function h(s: TemplateStringsArray): unknown;` });
    assert.equal(ours(ls.getSemanticDiagnostics(file('a.ts'))).length, 0, 'h is declared locally, and not a tag yet');
    plugin.onConfigurationChanged({ tags: ['g'] });
    const other = service({ 'b.ts': `export const b = g\`<b></i>\`;` });
    other.plugin.onConfigurationChanged({ tags: ['g'] });
    assert.deepEqual(ours(other.ls.getSemanticDiagnostics(other.file('b.ts'))).map(d => d.code), [9800, 9801]);
});
