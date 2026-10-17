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

I think this package should absolutely feel free to modify DX/tree.ts from assign-gingerly now and going forward to best support this extension.  The way I intend to use DX/tree.ts is strictly during build time / server side processing, not in the browser, so I'm not at all worried about file size.  Perhaps in the future we could add another slimmed down version of DX/tree.ts for browser specific client generation (as is done in the demo), but only if needs warrant which I don't anticipate for my personal use at this time.

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
