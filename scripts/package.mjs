// Packages the VS Code extension as a .vsix.
//
// vsce either leaves node_modules out (--no-dependencies) or, inside an npm workspace, takes in
// the whole repo. So the extension is staged in .package/ (outside the workspaces): its manifest,
// docs, dist/ and node_modules/gingerly-tree-ts-plugin (where tsserver looks for the plugin).

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, 'packages', 'vscode');
const stage = path.join(root, '.package');

execSync('node scripts/build.mjs', { cwd: root, stdio: 'inherit' });

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage);
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'package.json'), 'utf8'));
const plugin = JSON.parse(fs.readFileSync(path.join(extension, 'node_modules', 'gingerly-tree-ts-plugin', 'package.json'), 'utf8'));
manifest.dependencies = { [plugin.name]: plugin.version };
// "type": "module" is for this repo's own .ts files; the shipped entry points are .cjs
delete manifest.type;
fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
// Everything staged ships
fs.writeFileSync(path.join(stage, '.vscodeignore'), '.vscodeignore\n');
for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE', 'icon.png']) {
    const from = fs.existsSync(path.join(extension, file)) ? path.join(extension, file) : path.join(root, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(stage, file));
}
fs.cpSync(path.join(extension, 'dist'), path.join(stage, 'dist'), { recursive: true });
fs.cpSync(path.join(extension, 'node_modules', 'gingerly-tree-ts-plugin'), path.join(stage, 'node_modules', 'gingerly-tree-ts-plugin'), { recursive: true });

const out = path.join(root, `${manifest.name}-${manifest.version}.vsix`);
execSync(`npx --yes @vscode/vsce package --out "${out}"`, { cwd: stage, stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true });
