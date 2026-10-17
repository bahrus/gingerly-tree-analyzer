# Initial Implementation

## Bruce's Ask

As we agreed in [gingerly-tree](../../gingerly-tree/Chats/InitialImplementation.md#claudes-response-i), I've created this package to support the more dynamic, typescript focused language support to extend / complement what the safe gingerly-tree VS Code extension provides.

Can you please restate / update whatever questions need to be resolved before proceeding with this extension below?

## Claude's Questions

Updated from [gingerly-tree's first round](../../gingerly-tree/Chats/InitialImplementation.md#claudes-questions), with what we've learned since:
- **gingerly-tree covers highlighting everywhere**, including the Markdown Preview. This package adds no grammar or highlighting; it declares `"extensionDependencies": ["andersonbruceb.gingerly-tree"]`.
- **assign-gingerly is unchanged on this point.** `DX/tree.ts` still exports only `tree`, `each` and `TreeTemplateError`, so there's no way yet to analyze a template without running it (question 3).

### 1. Architecture: a TypeScript plugin, our own engine, or both?

You described this package as **TypeScript-focused**. That changes my earlier recommendation, so here is the trade-off again:

| | TS server plugin (like lit-plugin) | Extension-side engine (our own finder + parser) |
|---|---|---|
| `.js` / `.ts` files | ✅ | ✅ |
| HTML `<script>`, Markdown code blocks | ❌ (no plugins there) | ✅ |
| **Type-aware checks**: `.prop` names against the element's type (`HTMLElementTagNameMap`), `@event` names against `HTMLElementEventMap`, `ish=${…}` being a manager class, the type of `${p.name}` | ✅ (has the type checker) | ❌ (syntax only, no project types) |
| Diagnostics where TS shows its own: the Problems panel, quick fixes, the same squiggles | ✅ | ✅, though separate from TS's |
| VS Code for the Web | ❌ (vscode.dev doesn't load TS plugins) | ✅, given a `browser` entry and no Node APIs |

**My recommendation: both, sharing one analyzer core.**
- **A TS server plugin** for script files, with the type-aware features.
- **A thin extension-side provider** for HTML and Markdown, with syntax-level diagnostics and hover.

The extension activates the plugin through `contributes.typescriptServerPlugins`. Both call the same pure analyzer, which comes from assign-gingerly (question 3).

**Is that right, or do you want script files only (the plugin alone) for v1, with HTML and Markdown later?**

### 2. Feature scope for v1

My proposal:
- **v1:**
  - **diagnostics:** every `TreeTemplateError`, at its exact position;
  - **hover on a template:** the tree notation it produces;
  - **hover on a construct:** short docs for `.prop`, `@event`, `ish` and `each(…)`.
- **v1, script files only (needs types):**
  - **completions:** tag names, attributes, `.prop` names from the element's type, `@event` names;
  - **type checks:** unknown `.prop` or `@event` names (warnings), and an `ish=${…}` that isn't a class or registered name.
- **Later:**
  - go-to-definition for `ish=${Manager}`;
  - a code action converting raw `[tag, pattern, children]` notation ⇄ `` tree`…` ``;
  - **custom elements:** reading `custom-elements.json` manifests (as lit-analyzer does) to know custom elements' properties and events.

Does that split suit you? Should anything move between tiers?

### 3. A static entry point in assign-gingerly (needs your OK)

`tree()` decides some errors from runtime **values**:
- whether a `${…}` in attribute position is `each(…)` or a pattern object;
- whether an `@event` value is a string or a config;
- whether content is a nested `` tree`…` ``.

An analyzer can't evaluate those, but it can classify each hole by its syntax. I'd add a small, pure export to `DX/tree.ts`, e.g. `analyzeTree(strings, holeKinds)`. It would return:
- the parse, with positions;
- the produced notation, with placeholders for unknown values;
- the errors.

`tree()` itself would use the same parser, so the tag and the analyzer can't drift apart. **OK to add it to assign-gingerly** (with tests and docs there)?

### 4. Which copy of assign-gingerly the analyzer uses

- **(a) Bundled:** a fixed version, built into the extension.
- **(b) The workspace's own** `node_modules/assign-gingerly` when present, falling back to (a). This matches the version a project actually uses, but runs workspace code, so only in trusted workspaces.

I'd start with **(a)**, and add (b) once `analyzeTree` has settled. A TS plugin could instead resolve assign-gingerly from the project being analyzed, which is close to (b) for free. Agreed?

### 5. Hover preview fidelity

Statically:
- `${p.name}` → `'?.name'`, read from the proxy chain;
- `${'?.name'}` → itself.

In script files the type checker can do better, e.g. a `const` string. Anything still unknown shows as a placeholder such as `‹expr›`. **Good enough?**

### 6. Tag-name aliases

Unlike the grammar, code can read settings. Should the analyzer honor a `gingerlyTree.tags` setting, e.g. for `import { tree as t }`? Highlighting would still only cover `tree`, `🌲` and `DX.tree`, so an alias would get diagnostics but no colors. In script files, the TS plugin could instead follow imports from `assign-gingerly/DX/tree.js` whatever the local name, with no setting at all. Which do you prefer?

### 7. Checking outside the editor

TS plugins don't run under `tsc`. Would you like a **CLI** (`npx gingerly-tree-analyzer check src/**/*.ts docs/**/*.md`) for CI, as lit-analyzer has? If so, I'd use a layout with the core separate from the extension (question 9).

### 8. Web support

The TS plugin can't run on vscode.dev, but the extension-side provider (HTML/Markdown, and syntax-level checks on script files) could, with a `browser` entry. **Does web matter for the analyzer, or is desktop enough?**

### 9. Repo layout

- **Single package:** this folder is the extension, holding the plugin and the provider.
- **Monorepo:**
  - `packages/core`: the pure analyzer;
  - `packages/ts-plugin`;
  - `packages/vscode`;
  - optionally `packages/cli`.

I'd go with the **monorepo** if you want the CLI (question 7), and a single package otherwise.

### 10. Housekeeping

- Publisher `andersonbruceb`, published to both the Marketplace and Open VSX, as for gingerly-tree?
- Name `gingerly-tree-analyzer`, display name "Gingerly Tree Analyzer"?
- TypeScript, bundled with esbuild.
- **Tests:**
  - unit tests for the core;
  - `@vscode/test-electron` for the extension;
  - TS-plugin tests through a tsserver harness.

## Bruce's Response I

> typescript focused language support

I want to emphasize that I am not at all an expert in VS Code extensions, so my answers to your questions should be treated as "guesses", that I am happy if you override based on my comments.  I chose the terms "typescript focused language support" without any intention to sway any decisions, I just wasn't sure what to call it.  If my choice of words swayed you to support features that you really didn't think was a good idea initially, and you are only supporting an idea against your instincts because of my word choice, maybe reconsider.

The ability to provide more checkboxes of support by supporting both a TS server plugin *and* and extension-side engine, that checks off more capabilities, evidently with no interference, sounds quite appealing.

On the other hand, if doing so removes the ability to work in the web, then I would need to reconsider.  That is still a secondary goal, so anything that could be done to improve web support is also something to desire.

> ### 2. Feature scope for v1

Your breakdown for v1 feature support sounds great.

> ### 3. A static entry point in assign-gingerly (needs your OK)

I think this package should absolutely feel free to modify DX/tree.ts from assign-gingerly now and going forward to best support this extension.   Note that assign-gingerly is a subfolder of the root folder in which this vs code session is open (i.e. ../assign-gingerly) The way I intend to use DX/tree.ts is strictly during build time / server side processing, not in the browser, so I'm not at all worried about file size.  Perhaps in the future we could add another slimmed down version of DX/tree.ts for browser specific client generation (as is done in the demo), but only if needs warrant which I don't anticipate for my personal use at this time.

> ### 4. Which copy of assign-gingerly the analyzer uses

This is where I need to lean heavily on your judgement.  My one concern about your recommended approach is that I could definitely see myself forgetting to update the bundled files when assign-gingerly changes, whereas running npm run update is something I do as a matter of habit.

But I will lean heavily on you (or other AI) as far as supporting this package, so I will hope that AI will always be on the lookout for changes.

> ### 5. Hover preview fidelity

Probably good enough.  I'll have to see this in action and come back to you if this proves to be a serious shortcoming.

> ### 6. Tag-name aliases

Supporting a gingerlyTree.tags setting is definitely a nice to have if it doesn't block us from doing anything.  That would be most effective for *.md files.

I think being more accurate based on imports would be preferable when possible, so helping the user realize they are missing an import sounds like a good thing.

> ### 7. Checking outside the editor

This sounds useful.  Let's support with a core folder within the monorepo.

> ### 8. Web support

The TS plugin can't run on vscode.dev, but the extension-side provider (HTML/Markdown, and syntax-level checks on script files) could, with a `browser` entry. **Does web matter for the analyzer, or is desktop enough?**

If it's possible to expose limited functionality in this plug-in that could extend web support, that would certainly be nice.  Is that possible?  Or is my suspicion correct that a plug in is either all web compatible or not closer to the truth?  Does adding more web support lend itself to thinking maybe there should be a third separate extension?  We can hold off on that for now.


> ### 9. Repo layout

Your recommended layout sounds good to me.

> ### 10. Housekeeping

Everything you propose sounds fine to me.

## Claude's Response I

**On your wording:** it didn't push me against my instincts. I'd recommend **both** whatever the package was called:
- Without the TS plugin, script files get no type-aware checks, and those are where the analyzer adds most over the tag's own runtime errors. Examples: a `.prop` that isn't a property of that element, an `@event` name that doesn't exist, or a misspelled `ish` manager.
- Without the extension-side engine, HTML and Markdown get nothing, which is lit-plugin's gap.

One design point follows from doing both. **On desktop, the extension-side provider leaves `.js`/`.ts` files to the TS plugin**, so script files don't get each diagnostic twice. On the web, where the plugin can't run, the provider covers them too (syntax-level).

### 8. Web support: one extension can do both, so no third extension

An extension isn't all-or-nothing:
- It can declare a **`main`** entry (Node, desktop) **and** a **`browser`** entry (a web worker, for vscode.dev and github.dev). Each environment loads the one it supports.
- **`contributes.typescriptServerPlugins` is simply inert on the web**, so the TS plugin doesn't stop the rest from working there.

So the same extension gives:

| | Desktop | Web |
|---|---|---|
| Script files | TS plugin: diagnostics, hover, completions, type checks | provider: diagnostics and hover, syntax-level |
| HTML, Markdown | provider: diagnostics and hover | provider: diagnostics and hover |
| Workspace's own assign-gingerly (question 4) | ✅ | ❌, bundled copy only (no Node, no `node_modules`) |

The cost is that the provider and the core must avoid Node APIs, which is easy for a parser. **A third extension isn't needed.**

### 4. Keeping the analyzer's assign-gingerly current

Your concern is the right one, so here's a plan where the habit you already have does the work:
1. **The core lists `assign-gingerly` as an ordinary npm dependency**, not copied files. `npm run update` (`ncu -u && npm install`) bumps it like any other, and esbuild bundles whatever is installed when the extension is packaged.
2. **In script files, the TS plugin uses the *project's own* assign-gingerly.** tsserver resolves `assign-gingerly/DX/tree.js` from the project being edited, so diagnostics match the version that project actually uses, with no bundled copy involved. It falls back to the bundled copy if the project's version predates `analyzeTree`.
3. **On desktop, in trusted workspaces, the provider does the same** for HTML and Markdown: it uses `node_modules/assign-gingerly` from the workspace when it's there, and falls back to the bundled copy otherwise, or on the web.
4. **The hover footer names the copy used**, e.g. *"assign-gingerly 0.0.99 (workspace)"*, so a stale version is visible at a glance.
5. **`StepsToPublish.md` starts with `npm run update`**, and a test fails if the bundled version is older than the one in `../assign-gingerly`, so a stale bundle is caught before publishing.

### 6. Tag names: imports first, a setting for Markdown

- **Script files:** the plugin follows imports. Whatever name `tree` is imported under from `assign-gingerly/DX/tree.js` (`tree`, `t`, `DX.tree`) is analyzed.
- **A `tree` that isn't imported:** TypeScript already reports *"Cannot find name 'tree'"* in checked files. For unchecked JS, the plugin adds a gentle *"tree isn't imported from assign-gingerly/DX/tree.js"* with a quick fix that adds the import.
- **HTML and Markdown**, where snippets often have no imports: the provider matches by name, using `gingerlyTree.tags` (default `["tree", "🌲", "DX.tree"]`) plus any names that snippet imports.

### 3. The static entry point

Thanks. I'll add it to `../assign-gingerly/DX/tree.ts`, with tests and docs there:
- **The function:** `analyzeTree(strings, holeKinds)`, returning the parse, the notation with placeholders, and the errors with positions.
- **`tree()`** is rebuilt on the same parser, so behavior can't drift. Its existing tests must still pass unchanged.
- **Offsets:** I'll also make the error offsets **raw**, i.e. source positions with escapes unresolved, which removes the caveat from the earlier notes.

**Build-time / server-side only use of `tree()`** doesn't change anything here: the analyzer only reads source.

### The plan, then

1. **assign-gingerly:** `analyzeTree` + raw offsets, tests, docs, `tsc` clean.
2. **This repo**, as a monorepo:
   - **`packages/core`:** finding templates in JS/TS, HTML and Markdown; hover rendering; type-free checks. Pure, so it runs in Node and in browsers.
   - **`packages/ts-plugin`:** diagnostics, hover, completions and type checks in script files.
   - **`packages/vscode`:**
     - the extension, with `main` + `browser` entries;
     - the HTML/Markdown provider, plus script files on the web;
     - the `gingerlyTree.tags` setting;
     - `extensionDependencies` on gingerly-tree;
     - `typescriptServerPlugins`.
   - **`packages/cli`:** `npx gingerly-tree-analyzer check <globs>`, for CI.
3. **Tests at each level**, plus a `StepsToPublish.md` for the Marketplace and Open VSX.

I'd do it in that order. Step 1 is small and makes everything else possible, so I'd check back after the core and the plugin are working, before completions and the CLI. **Shall I proceed?**

## Bruce's Response II

Everything sounds great!  Please proceed.

## Claude's Implementation Notes

Done, up to the agreed checkpoint: **assign-gingerly's `analyzeTree`, the core, the TS plugin and the VS Code extension** (desktop and web). **Not yet:** completions and the CLI. Nothing is committed or published.

**Results:**

| | |
|---|---|
| `npm test` (unit) | **28 / 28**: core 17, plugin 10, tsserver 1 |
| `npm run test:e2e` (your VS Code 1.142) | **6 / 6** |
| `npm run test:web` (VS Code for the Web, headless Chromium) | **5 / 5** |
| `npm run typecheck` | clean |
| `npm run package` | `gingerly-tree-analyzer-0.0.1.vsix`, 2.2 MB |
| assign-gingerly's full suite (in a scratch copy, see below) | **149 passed, 4 skipped**, in Chromium, Firefox and WebKit |

### 1. assign-gingerly (`../assign-gingerly`)

**`DX/tree.ts`:**
- **`analyzeTree(strings, values)`** is the tag's own parser and rules. It **returns** `{ spec, elements, errors }` instead of throwing, and caches nothing.
  - **`elements`:** the parsed tree, with each tag's, attribute's and directive's location. This is what the type checks use, and completions will.
  - **`tree()` is now built on the same functions** (`createContext`, `parseRoot`, `toSpec`), so the two can't drift apart.
- **`TreeUnknown`:** the stand-in for a `${…}` that can't be known statically. Tree treats it leniently:
  - **in attribute position**, it may be `each(…)` or a pattern object;
  - **as content**, it's a child where children are expected (siblings are elements, or the element has `each(…)`), and text otherwise;
  - **as an `@event` value**, it's accepted.

  It shows as `‹text›` in the notation. Without this leniency, `${item}` as a repeat item, or the demo's `${action}` between children, would have been false errors.
- **Error offsets are now raw** (source) offsets, as offered earlier: `offset` counts characters of `strings.raw[part]`, so escapes before an error no longer shift it.
  - **This changed three expectations in the existing Test 9.** Those templates contain `\n` escapes, which are 2 source characters each, so the offsets there grew by 1. The line/column values are unchanged.

**Elsewhere in assign-gingerly:**
- **Types** (`TreeAnalysis`, `TreeTemplateElement`, `TreeTemplateAttribute`, `TreeTemplateStrings`) are in `types/assign-gingerly/treeTypes.d.ts`. **`types` is a submodule**, so that change needs its own commit there.
- **Tests:** `tests/dx-tree.html` has Tests 10–13: raw offsets, `analyzeTree` against the tag, `TreeUnknown` leniency, and element locations. It's 51 / 51 in all three browsers.
- **Docs:** `docs/tree.md` covers the raw offsets and `analyzeTree` / `TreeUnknown`.

**Per CLAUDE.md, I didn't generate the `.js`.** I verified everything in a scratch copy: `tsc` there, then the full Playwright suite. **Please run your build** to get `DX/tree.js` with `analyzeTree`. The analyzer doesn't wait for that (see 4).

### 2. This repo

It's the monorepo we agreed on. See [README.md](../README.md) for the layout, the scripts and debugging (F5 loads both extensions from source).
- **`packages/core`** (pure; given a TypeScript module, so it runs in Node, tsserver and web workers):
  - **Finding templates:** in JS/TS by syntax, plus in Markdown code blocks (any case, `~~~` and indented fences included) and HTML `<script>` tags, skipping `src`, JSON and import maps.
  - **Tag names:** imports first (`tree`, `tree as t`, `import * as DX` → `DX.tree`); then the `tags` setting, unless the name is declared locally.
  - **Stand-ins for each `${…}`:**
    - literals;
    - `paths()` chains → `'?.a?.b'` (`.Path` included);
    - `each(…)` → the real `each`;
    - object and array literals;
    - nested `` tree`…` `` → its spec;
    - consts followed within the file;
    - anything else → `TreeUnknown`.
  - **Positions:** errors map to exact source ranges, including CRLF files and escapes. The underline covers the tag, the attribute name, or the whole `${…}`.
  - **Hovers:** the notation, printed the way the docs write it (`['ul', {}, [ … ]]`), or the error. On an attribute, what it maps to. The footer names the assign-gingerly copy.
  - **`typeChecks`**, which needs a type checker:
    - **`.prop`:** checked against `HTMLElementTagNameMap[tag]`, including custom elements declared there. A warning.
    - **`@event`:** checked against `HTMLElementEventMap`. A *suggestion*, since delegated custom events are normal.
    - **`ish`:** must be a class, a string, or `any`. A warning.
  - **`paths` proxies** are also recognized by type (`PathProxy<…>`), not only by a `paths()` call in the same file.
- **`packages/ts-plugin`** wraps the language service:
  - semantic and suggestion diagnostics (source `gingerly-tree`, codes 9800–9804);
  - hovers, merged with TypeScript's own (on the tag, both show);
  - the missing-import quick fix (`getSupportedCodeFixes` includes it);
  - the `tags` setting, through `configurePlugin`;
  - **the project's own assign-gingerly** when it has `analyzeTree`, else the bundled copy (and it logs why).
- **`packages/vscode`**, the extension:
  - Markdown and HTML everywhere;
  - script files only where the plugin can't run, i.e. the web or the `useTsgo` preview, so there are **no duplicate diagnostics**;
  - the workspace's assign-gingerly in trusted workspaces;
  - `extensionDependencies` on gingerly-tree;
  - `typescriptServerPlugins`;
  - `untrustedWorkspaces: limited`.

### 3. Things I found that changed the plan

- **TypeScript 7 has no JS compiler API.** npm's `typescript@latest` is now 7.0.2 (the native port), which exports only `unstable/*` modules.
  - VS Code 1.142 still runs **TypeScript 6.0.3** (JS tsserver, so plugins load), so the analyzer pins `typescript@~6.0.3`.
  - **With VS Code's opt-in `typescript.experimental.useTsgo`, TS plugins don't load at all.** The extension notices and analyzes script files itself (errors and hovers, no type checks).
  - This is the likeliest thing to need revisiting as VS Code moves to TS 7.
- **`` 🌲`…` `` isn't valid JavaScript** (an emoji isn't an identifier), so TypeScript never sees a tagged template there, and it isn't analyzed. gingerly-tree still highlights it.
- **Shipping the plugin:**
  - **Where tsserver looks:** in the extension's `node_modules`.
  - **Why `vsce` can't package it directly:** in an npm workspace, `vsce` either drops `node_modules` or takes in the whole repo, `.git` included.
  - **The fix:** `scripts/package.mjs` stages the extension in `.package/` first.
  - **Tested:** `tsserver.test.ts` starts the real `tsserver.js` with `--globalPlugins … --pluginProbeLocations <extension>`, exactly as VS Code does.

### 4. Keeping assign-gingerly current: simpler than planned

Instead of a published-version dependency plus a staleness test, **assign-gingerly is linked from `../assign-gingerly`** (`file:`). esbuild bundles it **from its `.ts` sources**, so the bundled copy *is* the current source at every build. It can't go stale, and it doesn't depend on its `.js` being rebuilt.
- **The cost:** this repo expects to sit next to assign-gingerly, as in `beGingerly/`.
- **At runtime**, the plugin and the extension still prefer the **project's / workspace's own** copy when it has `analyzeTree`. Hovers say which copy is in use.

### 5. Next, after you've tried it

1. **Completions** (script files: tag names, attributes, `.prop` from the element's type, `@event`), using `elements` and the core.
2. **The CLI** (`packages/cli`): the core plus type checks on a `ts.Program`.
3. Publishing: gingerly-tree first, then this one ([StepsToPublish.md](../StepsToPublish.md)).

**To try it:** press F5 in this folder. It opens `packages/vscode/test/e2e/fixtures`, which has a broken template in `.md`, `.html` and `.ts` files.
