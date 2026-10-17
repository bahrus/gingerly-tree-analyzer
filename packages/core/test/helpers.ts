import ts from 'typescript';
import type { TreeEngine, TreeModule } from '../src/index.ts';

// assign-gingerly's source (Node strips its types), so tests don't depend on its built .js
const tree: TreeModule = await import(new URL('../../../node_modules/assign-gingerly/DX/tree.ts', import.meta.url).href);

export const engine: TreeEngine = { tree, version: 'test', origin: 'source' };
export { ts };

/** The source offset of the n-th occurrence of `needle`. */
export function at(text: string, needle: string, nth = 0): number {
    let index = -1;
    for (let i = 0; i <= nth; i++) {
        index = text.indexOf(needle, index + 1);
        if (index < 0) throw new Error(`${JSON.stringify(needle)} not found (occurrence ${nth})`);
    }
    return index;
}
