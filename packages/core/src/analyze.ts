// Analyzing the tree`…` templates of a source file, or of the script inside Markdown or HTML.

import type * as TS from 'typescript';
import { htmlRegions, markdownRegions, type ScriptLanguage } from './hosts.ts';
import { printNotation } from './notation.ts';
import { createStandIns, type StandInContext } from './standIns.ts';
import { collectImports, findSites, type Imports, type TemplateSite } from './templates.ts';
import { Codes, type Finding, type Hover, type TreeAnalysis, type TreeEngine, type TreeTemplateElement, type Typescript } from './types.ts';

export const DEFAULT_TAGS = ['tree', 'DX.tree'];

export interface AnalyzerOptions {
    engine: TreeEngine;
    /** Tag names matched without an import (default: tree, DX.tree) */
    tags?: Iterable<string>;
    /** Warn when a template's tag isn't imported (script files, not Markdown or HTML snippets) */
    reportMissingImport?: boolean;
    isPathRoot?: StandInContext['isPathRoot'];
    resolveIdentifier?: StandInContext['resolveIdentifier'];
}

export interface SiteResult {
    site: TemplateSite;
    analysis: TreeAnalysis;
    values: unknown[];
}

/** The analysis of one source file (or one script region), in its own offsets. */
export interface FileAnalysis {
    sf: TS.SourceFile;
    imports: Imports;
    results: SiteResult[];
    findings: Finding[];
    engine: TreeEngine;
}

export function analyzeSourceFile(ts: Typescript, sf: TS.SourceFile, options: AnalyzerOptions): FileAnalysis {
    const { engine, tags = DEFAULT_TAGS, reportMissingImport = false } = options;
    const imports = collectImports(ts, sf);
    const sites = findSites(ts, sf, imports, { tags });
    const siteByNode = new Map(sites.map(site => [site.node as TS.Node, site]));
    const results = new Map<TemplateSite, SiteResult>();
    const inProgress = new Set<TemplateSite>();

    const standIn = createStandIns({
        ts, sf, imports, tree: engine.tree,
        isSite: (node): node is TS.TaggedTemplateExpression => siteByNode.has(node),
        nestedSpec: node => {
            const site = siteByNode.get(node)!;
            return inProgress.has(site) ? undefined : (analyzeSite(site).analysis.spec as object | undefined);
        },
        isPathRoot: options.isPathRoot,
        resolveIdentifier: options.resolveIdentifier,
    });

    function analyzeSite(site: TemplateSite): SiteResult {
        const done = results.get(site);
        if (done) return done;
        inProgress.add(site);
        const values = site.holes.map(standIn);
        const strings = Object.assign(site.parts.map(part => part.cooked), { raw: site.parts.map(part => part.raw) });
        const analysis = engine.tree.analyzeTree(strings, values);
        inProgress.delete(site);
        const result = { site, analysis, values };
        results.set(site, result);
        return result;
    }

    const findings: Finding[] = [];
    for (const site of sites) {
        const { analysis } = analyzeSite(site);
        for (const error of analysis.errors) {
            const start = site.parts[error.part]?.toSource(error.offset) ?? site.node.template.getStart(sf);
            findings.push({ start, length: errorLength(sf, site, start), message: cleanMessage(error.message), severity: 'error', code: Codes.templateError });
        }
        if (reportMissingImport && !site.imported) {
            const tag = site.node.tag;
            findings.push({
                start: tag.getStart(sf),
                length: tag.end - tag.getStart(sf),
                message: `${site.tag}\`…\` isn't imported from 'assign-gingerly/DX/tree.js'.`,
                severity: 'warning',
                code: Codes.notImported,
            });
        }
    }
    return { sf, imports, results: sites.map(analyzeSite), findings, engine };
}

/** Analyzes a document: a script file, or the script regions of Markdown or HTML. Offsets are the document's. */
export interface DocumentAnalysis {
    files: { offset: number; file: FileAnalysis }[];
    findings: Finding[];
}

export type DocumentKind = ScriptLanguage | 'markdown' | 'html';

export function analyzeDocument(ts: Typescript, text: string, kind: DocumentKind, options: AnalyzerOptions, fileName = 'document'): DocumentAnalysis {
    const regions = kind === 'markdown' ? markdownRegions(text)
        : kind === 'html' ? htmlRegions(text)
        : [{ start: 0, text, language: kind }];
    const isSnippet = kind === 'markdown' || kind === 'html';
    const files = regions.map(region => {
        const scriptKind = { js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX, ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX }[region.language];
        const sf = ts.createSourceFile(`${fileName}.${region.language}`, region.text, ts.ScriptTarget.Latest, true, scriptKind);
        const file = analyzeSourceFile(ts, sf, { ...options, reportMissingImport: options.reportMissingImport ?? !isSnippet });
        return { offset: region.start, file };
    });
    const findings = files.flatMap(({ offset, file }) => file.findings.map(finding => ({ ...finding, start: finding.start + offset })));
    return { files, findings };
}

// ── Hover ────────────────────────────────────────────────────────────────────

/** A hover at `pos` (a file offset), if it's in a template's markup or on its tag. */
export function hoverAt(ts: Typescript, file: FileAnalysis, pos: number): Hover | undefined {
    const { sf, engine } = file;
    // The innermost template whose markup (not a ${…}) contains pos
    let found: SiteResult | undefined;
    for (const result of file.results) {
        const { node, holes } = result.site;
        if (pos < node.getStart(sf) || pos >= node.end) continue;
        if (holes.some((_, i) => { const [from, to] = holeRange(result.site, i); return pos > from && pos < to - 1; })) continue;
        if (!found || node.getStart(sf) >= found.site.node.getStart(sf)) found = result;
    }
    if (!found) return undefined;
    const { site, analysis } = found;
    const footer = `\n\n---\n*assign-gingerly ${engine.version} (${engine.origin})*`;

    const attribute = attributeAt(site, analysis.elements, pos);
    if (attribute) {
        return { start: attribute.start, length: attribute.name.length, markdown: attributeDoc(attribute.name, attribute.tag) + footer };
    }
    const tag = site.node.tag;
    const start = pos < site.node.template.getStart(sf) ? tag.getStart(sf) : site.node.template.getStart(sf);
    const end = pos < site.node.template.getStart(sf) ? tag.end : site.node.end;
    const body = analysis.errors.length
        ? `**${site.tag}\`…\`** has an error:\n\n${cleanMessage(analysis.errors[0].message)}`
        : `**${site.tag}\`…\`** produces:\n\n\`\`\`js\n${printNotation(analysis.spec)}\n\`\`\``;
    return { start, length: end - start, markdown: body + footer };
}

/** Hover in a document's offsets. */
export function hoverInDocument(ts: Typescript, document: DocumentAnalysis, pos: number): Hover | undefined {
    for (const { offset, file } of document.files) {
        if (pos < offset || pos > offset + file.sf.text.length) continue;
        const hover = hoverAt(ts, file, pos - offset);
        if (hover) return { ...hover, start: hover.start + offset };
    }
    return undefined;
}

interface AttributeAt {
    name: string;
    tag: string;
    start: number;
}

function attributeAt(site: TemplateSite, elements: TreeTemplateElement[], pos: number): AttributeAt | undefined {
    for (const element of elements) {
        for (const attribute of element.attributes) {
            const start = site.parts[attribute.location.part]?.toSource(attribute.location.offset);
            if (start !== undefined && pos >= start && pos < start + attribute.name.length) return { name: attribute.name, tag: element.tag, start };
        }
        const inChild = attributeAt(site, element.children, pos);
        if (inChild) return inChild;
    }
    return undefined;
}

function attributeDoc(name: string, tag: string): string {
    if (name.startsWith('.')) {
        const prop = name.slice(1);
        return `**\`.${prop}\`**: sets the \`${prop}\` **property** of the \`<${tag}>\` (not an attribute).\n\nIn the pattern: \`${prop}: value\`.`;
    }
    if (name.startsWith('@')) {
        const event = name.slice(1);
        return `**\`@${event}\`**: an **event binding** on the \`<${tag}>\`.\n\nThe value is a method name (\`\${'save'}\`) or a config (\`\${{ call: 'save' }}\`). In the pattern: \`' +=': { on: '${event}', … }\`. At most two per element.`;
    }
    if (name === 'ish') {
        return `**\`ish\`**: attaches an **itemscope manager** to the \`<${tag}>\`: a class, or a registered name.\n\nThe header becomes \`{ tag: '${tag}', ish }\`, and the element's subtree binds against the manager instance.`;
    }
    if (name === 'itemscope') {
        return `**\`itemscope\`**: the \`<${tag}>\` has **microdata**. Each path value in its text becomes a \`{ prop, val }\` microJoin segment, rendered with an \`itemprop\` named after the path's last segment (\`\${p.date}\` → \`itemprop="date"\`).\n\nIn the pattern: \`'itemscope :=': true\`. Write \`\${{ prop, val, text }}\` for another name or formatted text.`;
    }
    return `**\`${name}\`**: an **attribute** of the \`<${tag}>\`.\n\nIn the pattern: \`'${name} :=': value\`. A literal value is baked into the template under \`compile\`.`;
}

// ── Messages ─────────────────────────────────────────────────────────────────

/** `tree\`…\`: <p>: … (line 2, column 6)\n<frame>` → `<p>: …` */
function cleanMessage(message: string): string {
    return message.replace(/^tree`…`: /, '').replace(/ \(line \d+, column \d+\)\n[\s\S]*$/, '');
}

/** How much to underline at an error: the tag, the attribute name, the ${…}, or the word there. */
function errorLength(sf: TS.SourceFile, site: TemplateSite, start: number): number {
    const hole = site.holes.findIndex((_, i) => holeRange(site, i)[0] === start);
    if (hole >= 0) return holeRange(site, hole)[1] - start;
    const rest = sf.text.slice(start, start + 200);
    const match = /^<\/?[A-Za-z][\w:.-]*>?/.exec(rest) ?? /^[^\s=>"'`<]+/.exec(rest);
    return match ? match[0].length : 1;
}

/** Source range of the i-th `${…}`, from its `$` to after its `}`. */
export function holeRange(site: TemplateSite, i: number): [number, number] {
    const before = site.parts[i];
    return [before.toSource(before.raw.length), site.parts[i + 1].start];
}
