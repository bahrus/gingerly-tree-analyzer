// tsserver loads the plugin from the extension folder, as VS Code starts it:
// --globalPlugins gingerly-tree-ts-plugin --pluginProbeLocations <extension>.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..', '..', '..');
const extension = path.join(root, 'packages', 'vscode');
const tsserver = require.resolve('typescript/lib/tsserver.js');

/** A tsserver session: send a request, await its response. */
function startServer() {
    const child = spawn(process.execPath, [tsserver, '--globalPlugins', 'gingerly-tree-ts-plugin', '--pluginProbeLocations', extension, '--disableAutomaticTypingAcquisition'], {
        cwd: root,
        stdio: ['pipe', 'pipe', 'inherit'],
    });
    let buffer = '';
    let seq = 0;
    const waiting = new Map<number, (body: any) => void>();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
        buffer += chunk;
        for (;;) {
            const header = /Content-Length: (\d+)\r\n\r\n/.exec(buffer);
            if (!header) return;
            const start = header.index + header[0].length;
            const length = Number(header[1]);
            const bytes = Buffer.from(buffer.slice(start), 'utf8');
            if (bytes.length < length) return;
            const message = JSON.parse(bytes.subarray(0, length).toString('utf8'));
            buffer = bytes.subarray(length).toString('utf8');
            if (message.type === 'response') waiting.get(message.request_seq)?.(message);
        }
    });
    const request = (command: string, args: object) => new Promise<any>(resolve => {
        const id = ++seq;
        waiting.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ seq: id, type: 'request', command, arguments: args })}\n`);
    });
    const notify = (command: string, args: object) => child.stdin.write(`${JSON.stringify({ seq: ++seq, type: 'request', command, arguments: args })}\n`);
    return { request, notify, stop: () => child.kill() };
}

test('tsserver loads the plugin from the extension and reports a template error', async () => {
    const server = startServer();
    try {
        const file = path.join(root, '__virtual__', 'tsserver-check.ts').replace(/\\/g, '/');
        const text = "import { tree } from 'assign-gingerly/DX/tree.js';\nexport const a = tree`<ul><li></ul>`;\n";
        server.notify('open', { file, fileContent: text, scriptKindName: 'TS', projectRootPath: root });
        const response = await server.request('semanticDiagnosticsSync', { file });
        const ours = response.body.filter((d: any) => d.source === 'gingerly-tree');
        assert.deepEqual(ours.map((d: any) => [d.code, d.text]), [[9800, "</ul> doesn't match <li>"]]);

        const hover = await server.request('quickinfo', { file, line: 2, offset: text.split('\n')[1].indexOf('<ul') + 1 });
        assert.match(hover.body.documentation, /tree`…`\*\* has an error/);
    } finally {
        server.stop();
    }
});
