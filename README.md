# gingerly-tree-analyzer

Language support for [assign-gingerly](https://github.com/bahrus/assign-gingerly)'s `` tree`…` `` tagged templates: diagnostics, hovers and type checks. Its companion is [gingerly-tree](https://github.com/bahrus/gingerly-tree), which provides the syntax highlighting.

What the extension does is described in [packages/vscode/README.md](packages/vscode/README.md), which is its Marketplace page.

## Layout

| Package | What | Runs in |
|---|---|---|
| [`packages/core`](packages/core) | Finds templates (in JS/TS, Markdown code blocks, HTML `<script>`), turns each `${…}` into a stand-in value, runs assign-gingerly's `analyzeTree`, and produces findings and hovers. It's given a TypeScript module rather than importing one. | Node and browsers |
| [`packages/ts-plugin`](packages/ts-plugin) | A tsserver plugin: diagnostics, hovers, type checks and a quick fix in `.js`/`.ts` files. Uses the project's own assign-gingerly when it has `analyzeTree`. | tsserver |
| [`packages/vscode`](packages/vscode) | The VS Code extension. It handles Markdown and HTML, and script files where the plugin can't run. It ships the plugin in its `node_modules`. | VS Code desktop (`main`) and web (`browser`) |

A CLI for CI (`npx gingerly-tree-analyzer check …`) is planned as `packages/cli`.

## assign-gingerly

assign-gingerly is linked from the sibling folder (`"assign-gingerly": "file:../assign-gingerly"`), so this repo expects to be checked out next to it, as in `beGingerly/`. The build bundles it **from its TypeScript sources** (see `scripts/build.mjs`), so the bundled copy always matches its current source, whether or not its `.js` has been rebuilt.

## Scripts

| | |
|---|---|
| `npm run build` | Bundles the plugin and the extension (esbuild) |
| `npm run typecheck` | `tsc` over all packages and tests |
| `npm test` | Builds, then runs the unit tests with `node --test`: core, the plugin on a real language service, and tsserver loading the plugin from the extension folder |
| `npm run test:e2e` | The extension in VS Code desktop: the local install, or a downloaded copy. It uses a fresh profile with other extensions disabled, and loads gingerly-tree from `../gingerly-tree`. |
| `npm run test:web` | The extension in VS Code for the Web (headless Chromium) |
| `npm run test:all` | All of the above |
| `npm run package` | Builds and writes `gingerly-tree-analyzer-<version>.vsix` (see [StepsToPublish.md](StepsToPublish.md)) |

Tests are TypeScript files run directly by Node (type stripping), so Node 22.18+ is needed.

**`npm run update` skips two packages** (`.ncurc.json`):
- **`typescript`** stays on 6.x. TypeScript 7 (the native port) has no JS compiler API, which the plugin, the core and the tests need, and VS Code still runs TS server plugins on 6.x. Revisit this when VS Code moves to TypeScript 7.
- **`@types/vscode`** must not be newer than `engines.vscode` in `packages/vscode/package.json`, or `vsce` refuses to package. Bump both together, deliberately.

## Debugging

Open this folder in VS Code and press F5 (*Run Extension*): it builds, then opens a window with this extension and gingerly-tree loaded from source.
- **The extension's log:** the *Gingerly Tree* output channel.
- **The plugin's log:** run *TypeScript: Open TS Server log* and look for `[gingerly-tree]`.
