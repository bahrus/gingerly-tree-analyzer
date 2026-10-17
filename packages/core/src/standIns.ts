// Turning a `${…}` expression into the value analyzeTree should see: the value itself when it's
// known statically (a '?.' string, a paths() chain, each(…), choose(…), an object, a nested tree`…`), or a
// TreeUnknown carrying the expression's text.

import type * as TS from 'typescript';
import type { Imports } from './templates.ts';
import { nameOf } from './templates.ts';
import type { TreeModule, Typescript } from './types.ts';

export interface StandInContext {
    ts: Typescript;
    sf: TS.SourceFile;
    tree: TreeModule;
    imports: Imports;
    /** The spec of a nested tree`…` (undefined if it has errors) */
    nestedSpec(node: TS.TaggedTemplateExpression): object | undefined;
    /** Whether `node` is a nested tree`…` template */
    isSite(node: TS.Node): node is TS.TaggedTemplateExpression;
    /** Is this identifier a paths() proxy? (The TS plugin also asks the type checker.) */
    isPathRoot?(id: TS.Identifier): boolean;
    /** The expression a const identifier stands for, if it can be followed */
    resolveIdentifier?(id: TS.Identifier): TS.Expression | undefined;
}

export function createStandIns(ctx: StandInContext): (expression: TS.Expression) => unknown {
    const { ts, sf, tree, imports } = ctx;
    const pathRoots = collectPathRoots(ts, sf, imports);
    const isPathRoot = (id: TS.Identifier) => pathRoots.has(id.text) || !!ctx.isPathRoot?.(id);
    const resolve = ctx.resolveIdentifier ?? defaultResolver(ts, sf);
    const unknown = (node: TS.Node) => new tree.TreeUnknown(shorten(node.getText(sf)));

    const standIn = (node: TS.Expression, depth = 0): unknown => {
        if (depth > 8) return unknown(node);
        while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
            || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)) {
            node = node.expression;
        }
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
        if (ts.isNumericLiteral(node)) return Number(node.text);
        if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
        if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
        if (node.kind === ts.SyntaxKind.NullKeyword) return null;
        if (ts.isIdentifier(node) && node.text === 'undefined') return undefined;
        if (ctx.isSite(node)) return ctx.nestedSpec(node) ?? unknown(node);

        const path = pathOfChain(ts, node, isPathRoot);
        if (path !== undefined) return path;

        if (ts.isCallExpression(node)) {
            const callee = nameOf(ts, node.expression);
            if (callee && (imports.each.has(callee) || (callee === 'each' && !imports.declared.has('each')))) {
                const [of, options] = node.arguments;
                const optionValues = options ? standIn(options, depth + 1) : {};
                return tree.each(of ? standIn(of, depth + 1) : undefined, isPlainObject(optionValues) ? optionValues : {});
            }
            if (tree.choose && callee && (imports.choose.has(callee) || (callee === 'choose' && !imports.declared.has('choose')))) {
                const [on, cases, fallback] = node.arguments;
                const caseValues = cases ? standIn(cases, depth + 1) : {};
                if (!on || !isPlainObject(caseValues)) return unknown(node);
                return tree.choose(standIn(on, depth + 1), caseValues as any, fallback ? standIn(fallback, depth + 1) as any : undefined);
            }
            return unknown(node);
        }
        if (ts.isObjectLiteralExpression(node)) {
            const result: Record<string, unknown> = {};
            for (const property of node.properties) {
                const key = property.name && propertyKey(ts, property.name);
                if (ts.isPropertyAssignment(property) && key !== undefined) result[key] = standIn(property.initializer, depth + 1);
                else if (ts.isShorthandPropertyAssignment(property)) result[property.name.text] = standIn(property.name, depth + 1);
                else result[key ?? '…'] = unknown(property);
            }
            return result;
        }
        if (ts.isArrayLiteralExpression(node)) return node.elements.map(element => standIn(element, depth + 1));
        if (ts.isIdentifier(node)) {
            const target = resolve(node);
            return target ? standIn(target, depth + 1) : unknown(node);
        }
        return unknown(node);
    };
    return expression => standIn(expression);
}

/** Variables initialized with paths(…): `const p = paths<Launch>();` */
function collectPathRoots(ts: Typescript, sf: TS.SourceFile, imports: Imports): Set<string> {
    const roots = new Set<string>();
    const visit = (node: TS.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
            const callee = nameOf(ts, node.initializer.expression);
            if (callee && (imports.paths.has(callee) || (callee === 'paths' && !imports.declared.has('paths')))) roots.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return roots;
}

/** `p.address.city` → '?.address?.city' (and `.Path` at the end is the same path). */
function pathOfChain(ts: Typescript, node: TS.Expression, isPathRoot: (id: TS.Identifier) => boolean): string | undefined {
    const segments: string[] = [];
    let current: TS.Expression = node;
    for (;;) {
        if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.name)) {
            segments.unshift(current.name.text);
            current = current.expression;
        } else if (ts.isElementAccessExpression(current) && ts.isStringLiteralLike(current.argumentExpression)) {
            segments.unshift(current.argumentExpression.text);
            current = current.expression;
        } else if (ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) {
            current = current.expression;
        } else {
            break;
        }
    }
    if (!ts.isIdentifier(current) || !isPathRoot(current)) return undefined;
    if (segments[segments.length - 1] === 'Path') segments.pop();
    return segments.length ? `?.${segments.join('?.')}` : '?.';
}

/** A const in the same file, when its name is declared exactly once. */
function defaultResolver(ts: Typescript, sf: TS.SourceFile): (id: TS.Identifier) => TS.Expression | undefined {
    let consts: Map<string, TS.Expression | null> | undefined;
    return id => {
        if (!consts) {
            consts = new Map();
            const visit = (node: TS.Node): void => {
                if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
                    const isConst = ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
                    const name = node.name.text;
                    consts!.set(name, consts!.has(name) || !isConst || !node.initializer ? null : node.initializer);
                } else if ((ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
                    consts!.set(node.name.text, null);
                }
                ts.forEachChild(node, visit);
            };
            visit(sf);
        }
        return consts.get(id.text) ?? undefined;
    };
}

function propertyKey(ts: Typescript, name: TS.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
    return undefined;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/** Expression text for display: one line, at most 40 characters. */
function shorten(text: string): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > 40 ? `${oneLine.slice(0, 39)}…` : oneLine;
}
