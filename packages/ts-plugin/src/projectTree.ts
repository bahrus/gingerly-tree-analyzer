// The project's own copy of assign-gingerly (node_modules/assign-gingerly, or the project being
// assign-gingerly itself), so diagnostics match the version the project uses.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TreeEngine, TreeModule } from 'gingerly-tree-analyzer-core';

/** Finds DX/tree.js from `dir` upwards; undefined if there's none, or it predates analyzeTree. */
export async function loadProjectTree(dir: string, log: (message: string) => void): Promise<TreeEngine | undefined> {
    const packageDir = findPackage(dir);
    if (!packageDir) return undefined;
    const file = path.join(packageDir, 'DX', 'tree.js');
    if (!fs.existsSync(file)) return undefined;
    const { version } = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    // A real dynamic import (esbuild would turn import() into require() in a CommonJS bundle)
    const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<TreeModule>;
    const tree = await importModule(pathToFileURL(file).href);
    if (typeof tree.analyzeTree !== 'function' || typeof tree.TreeUnknown !== 'function') {
        log(`the project's assign-gingerly ${version} predates analyzeTree; using the bundled copy`);
        return undefined;
    }
    return { tree, version, origin: 'project' };
}

function findPackage(start: string): string | undefined {
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
        const installed = path.join(dir, 'node_modules', 'assign-gingerly');
        if (fs.existsSync(path.join(installed, 'package.json'))) return installed;
        const own = path.join(dir, 'package.json');
        if (fs.existsSync(own)) {
            try {
                if (JSON.parse(fs.readFileSync(own, 'utf8')).name === 'assign-gingerly') return dir;
            } catch { /* not JSON: keep looking */ }
        }
        if (path.dirname(dir) === dir) return undefined;
    }
}
