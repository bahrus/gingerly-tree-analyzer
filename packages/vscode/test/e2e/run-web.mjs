// End-to-end in VS Code for the Web (in Playwright's Chromium): the extension's browser bundle,
// with gingerly-tree loaded too.
//
//   node packages/vscode/test/e2e/run-web.mjs

import { runTests } from '@vscode/test-web';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const extension = path.join(root, 'packages', 'vscode');

await runTests({
    browserType: 'chromium',
    headless: true,
    extensionDevelopmentPath: extension,
    extensionPaths: [path.resolve(root, '..', 'gingerly-tree')],
    extensionTestsPath: path.join(extension, 'test', 'e2e', 'suite-web.cjs'),
    folderPath: path.join(extension, 'test', 'e2e', 'fixtures'),
    quality: 'stable',
});
