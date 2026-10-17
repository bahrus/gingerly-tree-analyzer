# Gingerly Tree Analyzer

Diagnostics and hovers for [assign-gingerly](https://github.com/bahrus/assign-gingerly)'s `` tree`…` `` tagged templates, which produce [`builtIns.tree`](https://github.com/bahrus/assign-gingerly/blob/main/docs/tree.md) element specifications from lit-like markup.

Syntax highlighting comes from **[Gingerly Tree](https://marketplace.visualstudio.com/items?itemName=andersonbruceb.gingerly-tree)**, which is installed along with this extension.

## Features

- **The tag's errors, as you type.** Every error `` tree`…` `` would throw at runtime is shown where it is:
  - a mismatched or unclosed tag;
  - two root elements;
  - text after a child element;
  - an attribute that mixes text and `${…}`;
  - `each(…)` with more than one child;
  - a third `@event`;
  - …

  They come from assign-gingerly's own parser (`analyzeTree`), so they're exactly what the tag would throw.
- **Hover a template** to see the tree notation it produces:

  ```js
  ['article', { 'class :=': 'card', 'aria-label :=': '?.label' }, [
      ['h3', { 'class :=': 'title', textContent: '?.name' }],
      ['ul', {}, { each: ['li', { textContent: '?.name' }], of: '?.crew', key: '?.id' }],
  ]]
  ```

  `paths()` chains show as their `?.` paths. Expressions that can't be known statically show as `‹expr›`.
- **Hover an attribute** (`.prop`, `@event`, `ish`, or a plain attribute) for what it maps to.
- **Type checks in TypeScript and JavaScript files:**
  - `.prop` names are checked against the element's type (`HTMLElementTagNameMap`, including custom elements you've declared there);
  - non-standard `@event` names get a hint (custom events are fine);
  - `ish=${…}` must be a class or a registered name.
- **A missing import** of `tree` is flagged, with a quick fix that adds it.

## Where it works

| | VS Code desktop | VS Code for the Web (vscode.dev, github.dev) |
|---|---|---|
| `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, … | errors, hovers, type checks (through a TypeScript plugin) | errors and hovers |
| Markdown code blocks (`js`, `ts`, …, and `<script>` in `html` blocks) | errors and hovers | errors and hovers |
| HTML `<script>` tags | errors and hovers | errors and hovers |

## Settings

| Setting | Default | |
|---|---|---|
| `gingerlyTree.tags` | `["tree", "DX.tree"]` | Tag names analyzed without an import, mostly for Markdown and HTML snippets. In script files, whatever name `tree` is imported under from `assign-gingerly/DX/tree.js` is analyzed anyway (`import { tree as t }`). |

## Which assign-gingerly

Every hover ends with the version used, e.g. *assign-gingerly 0.0.99 (project)*:

| Origin | Used for |
|---|---|
| **project** | `.js`/`.ts` files on desktop: the project's own `node_modules/assign-gingerly` |
| **workspace** | Markdown and HTML on desktop, in trusted workspaces: the workspace's own copy |
| **bundled** | everywhere else, and whenever the project's copy predates `analyzeTree` |

## Notes

- **The native TypeScript 7 preview** (`typescript.experimental.useTsgo`) doesn't load TypeScript plugins. With it on, this extension analyzes script files itself: errors and hovers, without type checks.
- **One error per template:** the tag stops at its first error, and so do the diagnostics.
- The **`` 🌲`…` ``** spelling that Gingerly Tree highlights isn't valid JavaScript (an emoji isn't an identifier), so it isn't analyzed.
