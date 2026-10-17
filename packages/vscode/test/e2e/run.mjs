// End-to-end: runs test/e2e/suite.cjs inside VS Code, with gingerly-tree (the dependency) and
// this extension loaded from source, in a fresh profile with other extensions disabled.
//
//   node packages/vscode/test/e2e/run.mjs
//
// Uses the local VS Code install when it finds one (or VSCODE_EXECUTABLE), else downloads one.

import { runTests } from '@vscode/test-electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const extension = path.join(root, 'packages', 'vscode');
const grammar = path.resolve(root, '..', 'gingerly-tree');

function localVSCode() {
    if (process.env.VSCODE_EXECUTABLE) return process.env.VSCODE_EXECUTABLE;
    const candidates = [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
        '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
        '/usr/share/code/code',
    ];
    return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

// When run from inside VS Code (its terminal or an extension), this would start Code.exe as plain Node
delete process.env.ELECTRON_RUN_AS_NODE;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gingerly-tree-e2e-'));
try {
    await runTests({
        vscodeExecutablePath: localVSCode(),
        extensionDevelopmentPath: [grammar, extension],
        extensionTestsPath: path.join(extension, 'test', 'e2e', 'suite.cjs'),
        launchArgs: [
            path.join(extension, 'test', 'e2e', 'fixtures'),
            '--disable-extensions',
            '--disable-workspace-trust',
            '--skip-welcome',
            '--skip-release-notes',
            `--user-data-dir=${userData}`,
        ],
    });
} finally {
    fs.rmSync(userData, { recursive: true, force: true });
}
