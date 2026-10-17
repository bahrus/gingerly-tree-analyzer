// Runs inside VS Code for the Web (see run-web.mjs): the browser bundle analyzes Markdown, HTML,
// and script files too, since no TS plugin runs there.

const vscode = require('vscode');

function equal(actual, expected, message) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
}

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
    const folder = vscode.workspace.workspaceFolders[0].uri;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, name));
    await vscode.window.showTextDocument(document);
    return document;
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
    await check('the web bundle activates', async () => {
        const analyzer = vscode.extensions.getExtension('andersonbruceb.gingerly-tree-analyzer');
        if (!analyzer) throw new Error('not installed');
        await open('sample.md');
        await waitFor('activation', () => analyzer.isActive);
    });

    await check('Markdown: errors in code blocks', async () => {
        const document = await open('sample.md');
        const diagnostics = await waitFor('Markdown diagnostics', () => ours(document.uri).length === 2 && ours(document.uri));
        equal(diagnostics.map(d => d.message), ["</ul> doesn't match <li>", "</i> doesn't match <b>"], 'messages');
    });

    await check('HTML: an error in a script', async () => {
        const document = await open('sample.html');
        const diagnostics = await waitFor('HTML diagnostics', () => ours(document.uri).length && ours(document.uri));
        equal(diagnostics.map(d => d.message), ["</section> doesn't match <p>"], 'messages');
    });

    await check('TypeScript: covered by the extension itself on the web (syntax only, no type checks)', async () => {
        const document = await open('sample.ts');
        const diagnostics = await waitFor('TS diagnostics', () => ours(document.uri).length && ours(document.uri));
        equal(diagnostics.map(d => d.message), ["</i> doesn't match <b>"], 'messages');
    });

    await check('hover', async () => {
        const document = await open('sample.md');
        const position = document.positionAt(document.getText().indexOf('<p class'));
        const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, position);
        const text = hovers.flatMap(hover => hover.contents.map(content => content.value ?? String(content))).join('\n');
        if (!/\['p', \{ 'class :=': 'card', textContent: '\?\.name' \}\]/.test(text)) throw new Error(`hover: ${text}`);
    });

    console.log(`\n${results.join('\n')}\n`);
    const failed = results.filter(line => line.startsWith('✗')).length;
    if (failed) throw new Error(`${failed} of ${results.length} web checks failed`);
};
