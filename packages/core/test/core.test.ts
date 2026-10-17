import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, hoverInDocument, Codes } from '../src/index.ts';
import { at, engine, ts } from './helpers.ts';

const analyze = (text: string, kind: Parameters<typeof analyzeDocument>[2] = 'js', tags?: string[]) =>
    analyzeDocument(ts, text, kind, { engine, tags });
const errorsOf = (text: string, kind: Parameters<typeof analyzeDocument>[2] = 'js') =>
    analyze(text, kind).findings.filter(finding => finding.code === Codes.templateError);
const hover = (text: string, pos: number, kind: Parameters<typeof analyzeDocument>[2] = 'js') =>
    hoverInDocument(ts, analyze(text, kind), pos);

const IMPORTS = `import { tree, each } from 'assign-gingerly/DX/tree.js';\nimport { paths } from 'assign-gingerly/DX/paths.js';\nconst p = paths();\n`;

test('the design example: no findings, and the hover shows the notation', () => {
    const text = `${IMPORTS}const map = {
    launch: tree\`
        <article class="card" aria-label=\${p.label}>
            <h3 class="title">\${p.name}</h3>
            <p>Launched \${p.date} by \${p.rocket}</p>
            <ul \${each(p.crew, { key: '?.id' })}><li>\${'?.name'}</li></ul>
            <button @click=\${{ call: 'launch' }}>Launch</button>
        </article>\`,
};`;
    assert.deepEqual(analyze(text).findings, []);
    const { markdown } = hover(text, at(text, 'tree`') + 1)!;
    assert.match(markdown, /\['article', \{ 'class :=': 'card', 'aria-label :=': '\?\.label' \}/);
    assert.match(markdown, /\['p', \{ '\?\. =&': \{ microJoin: \['Launched ', '\?\.date', ' by ', '\?\.rocket'\] \} \}\]/);
    assert.match(markdown, /\{ each: \['li', \{ textContent: '\?\.name' \}\], of: '\?\.crew', key: '\?\.id' \}/);
    assert.match(markdown, /assign-gingerly test \(source\)/);
});

test('errors point at the construct, in source offsets', () => {
    const text = `${IMPORTS}const a = tree\`<ul>\n  <li></ul>\`;`;
    const [error] = errorsOf(text);
    assert.equal(error.message, "</ul> doesn't match <li>");
    assert.equal(error.start, at(text, '</ul>'));
    assert.equal(error.length, '</ul>'.length);
});

test('error offsets are right after escapes and in later static strings', () => {
    const escaped = `${IMPORTS}const a = tree\`<p>\\\`x\\\`</b>\`;`;
    assert.equal(errorsOf(escaped)[0].start, at(escaped, '</b>'));
    const later = `${IMPORTS}const a = tree\`<p>\${'?.a'}<b>x</b> trailing</p>\`;`;
    const [error] = errorsOf(later);
    assert.match(error.message, /text after a child element/);
    assert.equal(error.start, at(later, 'trailing'));
});

test('CRLF line endings map to the right source offsets', () => {
    const text = `${IMPORTS}const a = tree\`<ul>\r\n  <li>\r\n  </ul>\`;`.replace(/(?<!\r)\n/g, '\r\n');
    assert.equal(errorsOf(text)[0].start, at(text, '</ul>'));
});

test('a mixed attribute value underlines the attribute; a bad ${…} underlines the ${…}', () => {
    const mixed = `${IMPORTS}const a = tree\`<p class="a \${'?.x'}"></p>\`;`;
    const [error] = errorsOf(mixed);
    assert.equal(error.start, at(mixed, 'class'));
    const directive = `${IMPORTS}const a = tree\`<b \${ 42 }></b>\`;`;
    const [bad] = errorsOf(directive);
    assert.equal(directive.slice(bad.start, bad.start + bad.length), '${ 42 }');
});

test('unknown values are lenient: variables as children, items, directives and events', () => {
    const text = `${IMPORTS}function card(item, action, spread, handler) {
    return tree\`<div \${spread}>
        <span>Label</span>\${action}<span>x</span>
        <ul \${each(p.crew)}>\${item}</ul>
        <button @click=\${handler}>Go</button>
    </div>\`;
}`;
    assert.deepEqual(errorsOf(text), []);
});

test('choose(…): a switch as a child or an item, shown in the notation; errors inside its cases are reported', () => {
    const text = `import { tree, each, choose } from 'assign-gingerly/DX/tree.js';
const card = tree\`<article>
    <h3>\${'?.title'}</h3>
    \${choose('?.mode', { view: tree\`<span>Viewing</span>\`, quiet: null }, tree\`<p>Unknown</p>\`)}
</article>\`;
const list = tree\`<ol \${each('?.')}>\${choose('?.kind', { a: tree\`<li>A</li>\`, b: tree\`<li>B</i>\` })}</ol>\`;`;
    const findings = errorsOf(text);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].start, at(text, '</i>'));
    const { markdown } = hover(text, at(text, 'tree`') + 1)!;
    const oneLine = markdown.replace(/\s+/g, ' ');
    assert.match(oneLine, /\{ switch: '\?\.mode', cases: \{ view: \['span', \{ textContent: 'Viewing' \}\], quiet: null \}, default: \['p', \{ textContent: 'Unknown' \}\], \}/);
    const item = hover(text, at(text, 'tree`<ol') + 1)!.markdown;
    assert.match(item.replace(/\s+/g, ' '), /\{ each: \{ switch: '\?\.kind', cases: \{ a: \['li', \{ textContent: 'A' \}\], b: ‹tree`<li>B<\/i>`› \}/);
});

test('consts are followed: a tree`…` in a variable composes, and its errors are reported where it is', () => {
    const text = `${IMPORTS}const item = tree\`<li>\${'?.name'}</li>\`;
const list = tree\`<ul \${each('?.items')}>\${item}</ul>\`;
const broken = tree\`<b></i>\`;`;
    const findings = errorsOf(text);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].start, at(text, '</i>'));
    const { markdown } = hover(text, at(text, 'tree`', 1))!;
    assert.match(markdown, /\{ each: \['li', \{ textContent: '\?\.name' \}\], of: '\?\.items' \}/);
});

test('nested tree`…` inside ${…}: its errors are reported, and hovering inside it shows its own notation', () => {
    const text = `${IMPORTS}const a = tree\`<div>\${tree\`<b>\${'?.x'}</i>\`}</div>\`;`;
    const findings = errorsOf(text);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].start, at(text, '</i>'));
    const ok = `${IMPORTS}const a = tree\`<div>\${tree\`<b>\${'?.x'}</b>\`}</div>\`;`;
    assert.match(hover(ok, at(ok, '<b>'))!.markdown, /\['b', \{ textContent: '\?\.x' \}\]/);
    assert.match(hover(ok, at(ok, '<div>'))!.markdown, /\['div', \{\}, \[\['b', \{ textContent: '\?\.x' \}\]\]\]/);
});

test('paths() chains become ?. paths; .Path is the same path', () => {
    const text = `${IMPORTS}const a = tree\`<p .title=\${p.address.city.Path}>\${p.address.city}</p>\`;`;
    const { markdown } = hover(text, at(text, 'tree`'))!;
    assert.match(markdown, /\['p', \{ title: '\?\.address\?\.city', textContent: '\?\.address\?\.city' \}\]/);
});

test('unknown expressions show as ‹text› in the hover', () => {
    const text = `${IMPORTS}const a = (x) => tree\`<p>\${x.label}</p>\`;`;
    assert.match(hover(text, at(text, 'tree`'))!.markdown, /\['p', \{ textContent: ‹x\.label› \}\]/);
});

test('hovering an attribute explains it; inside ${…} there is no tree hover', () => {
    const text = `${IMPORTS}const a = tree\`<input .value=\${'?.v'} @input=\${'edit'} class="x" />\`;`;
    assert.match(hover(text, at(text, '.value') + 2)!.markdown, /\*\*`\.value`\*\*: sets the `value` \*\*property\*\*/);
    assert.match(hover(text, at(text, '@input'))!.markdown, /\*\*`@input`\*\*: an \*\*event binding\*\*/);
    assert.match(hover(text, at(text, 'class'))!.markdown, /\*\*`class`\*\*: an \*\*attribute\*\*/);
    assert.equal(hover(text, at(text, "'?.v'") + 1), undefined);
});

test('tag names: imports (aliases, namespaces) first; a local tree is not ours', () => {
    const aliased = `import { tree as t } from 'assign-gingerly/DX/tree.js';\nconst a = t\`<b></i>\`;`;
    assert.equal(errorsOf(aliased).length, 1);
    const namespaced = `import * as DX from 'assign-gingerly/DX/tree.js';\nconst a = DX.tree\`<b></i>\`;`;
    assert.equal(errorsOf(namespaced).length, 1);
    const local = `function tree(s) { return s; }\nconst a = tree\`<b></i>\`;`;
    assert.equal(analyze(local).findings.length, 0);
    const other = `import { html } from 'lit';\nconst a = html\`<b></i>\`;`;
    assert.equal(analyze(other).findings.length, 0);
});

test('a script file using tree without importing it gets a warning; with a setting, other names match', () => {
    const text = `const a = tree\`<b>\${'?.x'}</b>\`;`;
    const [warning] = analyze(text).findings;
    assert.equal(warning.code, Codes.notImported);
    assert.equal(warning.severity, 'warning');
    assert.equal(text.slice(warning.start, warning.start + warning.length), 'tree');
    const custom = `const a = h\`<b></i>\`;`;
    assert.equal(analyze(custom, 'js', ['h']).findings.filter(f => f.code === Codes.templateError).length, 1);
});

test('Markdown: JS/TS code blocks (any case) and <script> in HTML blocks; offsets in the document; no import warnings', () => {
    const md = [
        '# Doc', '',
        '```JS', "const a = tree`<b></i>`;", '```', '',
        '```typescript', "const b = tree`<em></i>`;", '```', '',
        '```html', '<p>tree`<b></i>`</p>', '<script type="module">', "  const c = tree`<u></i>`;", '</script>', '```', '',
        '```css', '.x { content: "tree`<b></i>`"; }', '```', '',
        "Prose with tree`<b></i>` isn't code.",
    ].join('\n');
    const findings = analyze(md, 'markdown').findings;
    assert.deepEqual(findings.map(f => f.code), [Codes.templateError, Codes.templateError, Codes.templateError]);
    assert.deepEqual(findings.map(f => f.start), [at(md, '</i>'), at(md, '</i>', 1), at(md, '</i>', 3)]);
    assert.match(hover(md, at(md, 'tree`<em>'), 'markdown')!.markdown, /has an error/);
});

test('Markdown: a fence can be indented (in a list) and ~~~; an unclosed one runs to the end', () => {
    const md = ['1. Step', '   ```js', "   const a = tree`<b></i>`;", '   ```', '', '~~~ts', "const b = tree`<b></i>`;", '~~~', '', '```js', "const c = tree`<b></i>`;"].join('\n');
    assert.equal(analyze(md, 'markdown').findings.length, 3);
});

test('HTML: inline module and classic scripts; not src scripts, JSON or text outside scripts', () => {
    const html = [
        '<p>tree`<b></i>`</p>',
        '<script type="module">const a = tree`<b></i>`;</script>',
        "<script>const b = tree`<em>${'?.x'}</em>`;</script>",
        '<script src="x.js">const c = tree`<b></i>`;</script>',
        '<script type="importmap">{ "imports": {} }</script>',
    ].join('\n');
    const findings = analyze(html, 'html').findings;
    assert.equal(findings.length, 1);
    assert.equal(findings[0].start, at(html, '</i>', 1));
    assert.match(hover(html, at(html, 'tree`<em>'), 'html')!.markdown, /\['em', \{ textContent: '\?\.x' \}\]/);
});

test('an unterminated template (while typing) does not throw', () => {
    assert.doesNotThrow(() => analyze(`${IMPORTS}const a = tree\`<div><p class="x`));
    assert.doesNotThrow(() => analyze(`${IMPORTS}const a = tree\`<div>\${`));
});
