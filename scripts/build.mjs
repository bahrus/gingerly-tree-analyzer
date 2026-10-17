// Builds the TS plugin and the VS Code extension with esbuild.
//
// assign-gingerly is bundled from its TypeScript sources (../assign-gingerly, linked through
// node_modules), so the bundles always match its current source, whether or not its .js has been
// rebuilt yet.

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const assignGingerly = fs.realpathSync(path.join(root, 'node_modules', 'assign-gingerly'));
const { version } = JSON.parse(fs.readFileSync(path.join(assignGingerly, 'package.json'), 'utf8'));
const watch = process.argv.includes('--watch');

/** A .js path inside assign-gingerly → its .ts source, when there is one. */
const preferSource = file => {
    const source = file.replace(/\.js$/, '.ts');
    return file.endsWith('.js') && fs.existsSync(source) ? source : file;
};
const inside = (file, dir) => path.relative(dir, file).split(path.sep)[0] !== '..';

const assignGingerlyFromSource = {
    name: 'assign-gingerly-from-source',
    setup(build) {
        build.onResolve({ filter: /^assign-gingerly\// }, args => ({
            path: preferSource(path.join(assignGingerly, args.path.slice('assign-gingerly/'.length))),
        }));
        build.onResolve({ filter: /^\.\.?\// }, args => {
            if (!args.importer || !inside(args.importer, assignGingerly)) return undefined;
            return { path: preferSource(path.join(path.dirname(args.importer), args.path)) };
        });
    },
};

const common = {
    bundle: true,
    sourcemap: false,
    minify: false,
    logLevel: 'warning',
    define: { BUNDLED_VERSION: JSON.stringify(version) },
    plugins: [assignGingerlyFromSource],
};

const pluginOut = path.join(root, 'packages', 'ts-plugin', 'dist', 'index.cjs');
const builds = [
    // The TS plugin: CommonJS for tsserver, which passes in its own typescript
    {
        ...common,
        entryPoints: [path.join(root, 'packages', 'ts-plugin', 'src', 'entry.cjs')],
        outfile: pluginOut,
        platform: 'node',
        format: 'cjs',
        external: ['typescript'],
    },
    // The extension, desktop
    {
        ...common,
        entryPoints: [path.join(root, 'packages', 'vscode', 'src', 'node.ts')],
        outfile: path.join(root, 'packages', 'vscode', 'dist', 'extension.cjs'),
        minify: true,
        keepNames: true,
        platform: 'node',
        format: 'cjs',
        external: ['vscode'],
    },
    // The extension, VS Code for the Web (a web worker); TypeScript's Node-only requires are never reached there
    {
        ...common,
        entryPoints: [path.join(root, 'packages', 'vscode', 'src', 'web.ts')],
        outfile: path.join(root, 'packages', 'vscode', 'dist', 'web.cjs'),
        minify: true,
        keepNames: true,
        platform: 'browser',
        format: 'cjs',
        external: ['vscode', 'fs', 'path', 'os', 'crypto', 'buffer', 'perf_hooks', 'inspector', 'source-map-support', 'node:*'],
        define: { ...common.define, 'process.env.NODE_ENV': '"production"' },
    },
];

/** The extension ships the plugin as node_modules/gingerly-tree-ts-plugin, where tsserver looks for it. */
function copyPluginIntoExtension() {
    const target = path.join(root, 'packages', 'vscode', 'node_modules', 'gingerly-tree-ts-plugin');
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(pluginOut, path.join(target, 'index.js'));
    fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify({ name: 'gingerly-tree-ts-plugin', version: '0.0.1', main: 'index.js' }, null, 2)}\n`);
}

if (watch) {
    for (const options of builds) await (await esbuild.context(options)).watch();
    console.log('watching…');
} else {
    await Promise.all(builds.map(options => esbuild.build(options)));
    copyPluginIntoExtension();
    for (const { outfile } of builds) console.log(`${path.relative(root, outfile)}  ${(fs.statSync(outfile).size / 1024).toFixed(0)} KB`);
    console.log(`(assign-gingerly ${version}, from ${path.relative(root, assignGingerly)})`);
}
