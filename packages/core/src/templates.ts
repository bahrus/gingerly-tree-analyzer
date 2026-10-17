// Finding tree`…` templates in a TypeScript/JavaScript source file.

import type * as TS from 'typescript';
import type { Typescript } from './types.ts';

const TREE_MODULE = /(?:^|\/)DX\/tree(?:\.[cm]?[jt]s)?$/;
const PATHS_MODULE = /(?:^|\/)DX\/paths(?:\.[cm]?[jt]s)?$/;

/** What a file imports from assign-gingerly's DX/tree.js and DX/paths.js, by local name. */
export interface Imports {
    /** Local names bound to `tree`: `tree`, an alias, or `ns.tree` for `import * as ns` */
    tree: Set<string>;
    each: Set<string>;
    choose: Set<string>;
    paths: Set<string>;
    /** Every other name a declaration in the file introduces (so a local `tree` isn't mistaken for ours) */
    declared: Set<string>;
    /** Where a new import can go: after the last import */
    importInsertAt: number;
}

export function collectImports(ts: Typescript, sf: TS.SourceFile): Imports {
    const imports: Imports = { tree: new Set(), each: new Set(), choose: new Set(), paths: new Set(), declared: new Set(), importInsertAt: 0 };
    for (const statement of sf.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        imports.importInsertAt = statement.end;
        const specifier = statement.moduleSpecifier.text;
        const isTree = TREE_MODULE.test(specifier);
        const isPaths = PATHS_MODULE.test(specifier);
        const bindings = statement.importClause?.namedBindings;
        if (!bindings) continue;
        if (ts.isNamespaceImport(bindings)) {
            const ns = bindings.name.text;
            if (isTree) { imports.tree.add(`${ns}.tree`); imports.each.add(`${ns}.each`); imports.choose.add(`${ns}.choose`); }
            if (isPaths) imports.paths.add(`${ns}.paths`);
            continue;
        }
        for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            const local = element.name.text;
            if (isTree && imported === 'tree') imports.tree.add(local);
            else if (isTree && imported === 'each') imports.each.add(local);
            else if (isTree && imported === 'choose') imports.choose.add(local);
            else if (isPaths && imported === 'paths') imports.paths.add(local);
        }
    }
    // Other declarations of the same names (so `function tree() {}` isn't analyzed)
    const visit = (node: TS.Node): void => {
        const name = (node as { name?: TS.Node }).name;
        const declares = ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isClassDeclaration(node)
            || ts.isParameter(node) || ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportClause(node);
        if (declares && name && ts.isIdentifier(name)) {
            const isOurs = ts.isImportSpecifier(node) && ts.isNamedImports(node.parent)
                && ts.isStringLiteral(node.parent.parent.parent.moduleSpecifier)
                && (TREE_MODULE.test(node.parent.parent.parent.moduleSpecifier.text) || PATHS_MODULE.test(node.parent.parent.parent.moduleSpecifier.text));
            if (!isOurs) imports.declared.add(name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return imports;
}

/** `tree`, or `DX.tree`: the name of an identifier or a one-level property access. */
export function nameOf(ts: Typescript, node: TS.Node): string | undefined {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && ts.isIdentifier(node.name)) {
        return `${node.expression.text}.${node.name.text}`;
    }
    return undefined;
}

/** A static string of a template, and how its offsets map to the source. */
export interface TemplatePart {
    /** Source offset of the part's first character (after the backtick or `}`) */
    start: number;
    cooked: string;
    /** As written, with line breaks normalized to \n (as a template literal's raw value is) */
    raw: string;
    /** Source offset of an offset into `raw` */
    toSource(rawOffset: number): number;
}

export interface TemplateSite {
    node: TS.TaggedTemplateExpression;
    /** The tag as written: `tree`, `t`, `DX.tree` */
    tag: string;
    parts: TemplatePart[];
    holes: TS.Expression[];
    /** Whether the tag is imported from DX/tree.js (rather than matched by name) */
    imported: boolean;
}

export interface FindOptions {
    /** Names matched without an import, e.g. ['tree', 'DX.tree'] */
    tags: Iterable<string>;
}

/** Every tree`…` template in the file, outermost first (nested ones included). */
export function findSites(ts: Typescript, sf: TS.SourceFile, imports: Imports, { tags }: FindOptions): TemplateSite[] {
    const byName = new Set(tags);
    const sites: TemplateSite[] = [];
    const visit = (node: TS.Node): void => {
        if (ts.isTaggedTemplateExpression(node)) {
            const tag = nameOf(ts, node.tag);
            const imported = !!tag && imports.tree.has(tag);
            const matched = !!tag && byName.has(tag) && !imports.declared.has(tag.split('.')[0]);
            if (tag && (imported || matched)) {
                const { template } = node;
                sites.push({
                    node,
                    tag,
                    parts: partsOf(ts, sf, template),
                    holes: ts.isNoSubstitutionTemplateLiteral(template) ? [] : template.templateSpans.map(span => span.expression),
                    imported,
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return sites;
}

function partsOf(ts: Typescript, sf: TS.SourceFile, template: TS.TemplateLiteral): TemplatePart[] {
    const { text } = sf;
    const part = (literal: TS.TemplateLiteralLikeNode & TS.Node, opensHole: boolean): TemplatePart => {
        const start = literal.getStart(sf) + 1;
        let end = literal.end;
        if (opensHole) end -= 2;
        else if (text[end - 1] === '`') end -= 1;
        return makePart(start, text.slice(start, end), literal.text);
    };
    if (ts.isNoSubstitutionTemplateLiteral(template)) return [part(template, false)];
    return [
        part(template.head, true),
        ...template.templateSpans.map(span => part(span.literal, ts.isTemplateMiddle(span.literal))),
    ];
}

export function makePart(start: number, source: string, cooked: string): TemplatePart {
    if (!source.includes('\r')) return { start, cooked, raw: source, toSource: offset => start + offset };
    // \r\n and lone \r count as one character in the raw value, but not in the source
    const sourceOffsets: number[] = [];
    let raw = '';
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\r' && source[i + 1] === '\n') continue;
        sourceOffsets.push(i);
        raw += source[i] === '\r' ? '\n' : source[i];
    }
    sourceOffsets.push(source.length);
    return { start, cooked, raw, toSource: offset => start + (sourceOffsets[Math.min(offset, raw.length)] ?? source.length) };
}
