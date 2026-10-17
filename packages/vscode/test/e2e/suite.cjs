// Runs inside VS Code (see run.mjs): the extension's diagnostics and hovers in Markdown and HTML,
// and the TS plugin's, through tsserver, in a .ts file.

const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const fixtures = path.join(__dirname, 'fixtures');

async function waitFor(what, fn, timeout = 60000) {
    const started = Date.now();
    for (;;) {
        const value = await fn();
        if (value) return value;
        if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

const ours = uri => vscode.languages.getDiagnostics(uri).filter(d => d.source === 'gingerly-tree');

async function open(name) {
    const document = await vscode.workspace.openTextDocument(path.join(fixtures, name));
    await vscode.window.showTextDocument(document);
    return document;
}

async function hoverText(document, needle) {
    const position = document.positionAt(document.getText().indexOf(needle));
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, position);
    return hovers.flatMap(hover => hover.contents.map(content => content.value ?? String(content))).join('\n');
}

const results = [];
async function check(name, fn) {
    try {
        await fn();
        results.push(`✓ ${name}`);
    } catch (error) {
        results.push(`✗ ${name}: ${error.message}`);
    }
}

exports.run = async () => {
    await check('both extensions are installed, and the analyzer activates', async () => {
        assert.ok(vscode.extensions.getExtension('andersonbruceb.gingerly-tree'), 'gingerly-tree (the dependency)');
        const analyzer = vscode.extensions.getExtension('andersonbruceb.gingerly-tree-analyzer');
        assert.ok(analyzer, 'gingerly-tree-analyzer');
        await open('sample.md');
        await waitFor('activation', () => analyzer.isActive);
    });

    await check('Markdown: errors in a JS code block and in <script> in an HTML block', async () => {
        const document = await open('sample.md');
        const diagnostics = await waitFor('Markdown diagnostics', () => ours(document.uri).length === 2 && ours(document.uri));
        const text = document.getText();
        assert.deepEqual(diagnostics.map(d => [d.message, document.offsetAt(d.range.start)]), [
            ["</ul> doesn't match <li>", text.indexOf('</ul>')],
            ["</i> doesn't match <b>", text.indexOf('</i>')],
        ]);
    });

    await check('Markdown: hovering a template shows its notation', async () => {
        const document = await open('sample.md');
        const text = await hoverText(document, '<p class');
        assert.match(text, /\['p', \{ 'class :=': 'card', textContent: '\?\.name' \}\]/);
    });

    await check('HTML: an error in a <script type="module">', async () => {
        const document = await open('sample.html');
        const [diagnostic] = await waitFor('HTML diagnostics', () => ours(document.uri).length && ours(document.uri));
        assert.equal(diagnostic.message, "</section> doesn't match <p>");
    });

    await check('TypeScript: the TS plugin reports the error and the .prop check, through tsserver', async () => {
        const document = await open('sample.ts');
        const diagnostics = await waitFor('TS plugin diagnostics', () => ours(document.uri).length >= 2 && ours(document.uri), 120000);
        const messages = diagnostics.map(d => d.message).sort();
        assert.deepEqual(messages, ["</i> doesn't match <b>", "Property 'valu' doesn't exist on <input> (HTMLInputElement)."]);
    });

    await check('TypeScript: the hover on a template comes from the TS plugin', async () => {
        const document = await open('sample.ts');
        const text = await waitFor('TS hover', async () => {
            const hover = await hoverText(document, '<input');
            return /produces/.test(hover) && hover;
        }, 60000);
        assert.match(text, /\['input', \{ valu: '\?\.v' \}\]/);
    });

    console.log(`\n${results.join('\n')}\n`);
    const failed = results.filter(line => line.startsWith('✗')).length;
    if (failed) throw new Error(`${failed} of ${results.length} end-to-end checks failed`);
};
