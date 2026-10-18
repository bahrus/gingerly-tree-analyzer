# Changelog

## Unreleased

- **An icon:** Gingerly Tree's icon under a magnifying glass (`icon.png`, drawn from `icon.svg`).
- **`choose(…)`** (assign-gingerly's switch): shown in hovers, and errors inside its cases are reported. With a project's own assign-gingerly that predates `choose`, it shows as `‹…›`.

## 0.0.1

- Diagnostics for `` tree`…` `` templates (the tag's own errors, from assign-gingerly's `analyzeTree`) in JS/TS files, Markdown code blocks and HTML `<script>` tags.
- Hovers: the tree notation a template produces; what an attribute maps to.
- In JS/TS files, through a TypeScript plugin:
  - `.prop` names checked against the element's type;
  - hints for non-standard `@event` names;
  - `ish=${…}` checked;
  - a missing `tree` import, with a quick fix.
- VS Code for the Web: errors and hovers everywhere, including script files.
