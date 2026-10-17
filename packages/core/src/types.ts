import type ts from 'typescript';

/** The TypeScript module: the analyzer is given one (tsserver's own, or a bundled copy) rather than importing it. */
export type Typescript = typeof ts;

/** assign-gingerly's DX/tree.js: the parts the analyzer uses. */
export type TreeModule = Pick<typeof import('assign-gingerly/DX/tree.js'), 'analyzeTree' | 'each' | 'TreeUnknown'>
    // Newer than analyzeTree: a project's own copy may predate it (then choose(…) stays unknown)
    & Partial<Pick<typeof import('assign-gingerly/DX/tree.js'), 'choose'>>;
export type TreeAnalysis = ReturnType<TreeModule['analyzeTree']>;
export type TreeTemplateElement = TreeAnalysis['elements'][number];

/** The assign-gingerly copy in use, and where it came from (shown in hovers). */
export interface TreeEngine {
    tree: TreeModule;
    version: string;
    /** e.g. 'bundled', 'workspace', 'project' */
    origin: string;
}

export type Severity = 'error' | 'warning' | 'suggestion';

/** A diagnostic, in source offsets of the analyzed document. */
export interface Finding {
    start: number;
    length: number;
    message: string;
    severity: Severity;
    code: number;
}

/** Diagnostic codes (shown as e.g. "gingerly-tree(9800)"). */
export const Codes = {
    /** A TreeTemplateError: the tag would throw at runtime */
    templateError: 9800,
    /** tree is used as a tag but isn't imported from assign-gingerly/DX/tree.js */
    notImported: 9801,
    /** .prop names a property the element's type doesn't have */
    unknownProperty: 9802,
    /** @event names an event the element's type doesn't declare */
    unknownEvent: 9803,
    /** ish=${…} is neither a class nor a registered name */
    ishNotManager: 9804,
} as const;

/** A hover: markdown, and the source range it applies to. */
export interface Hover {
    start: number;
    length: number;
    markdown: string;
}
