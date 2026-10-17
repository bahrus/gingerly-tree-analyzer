// Where script lives inside other documents: Markdown code blocks and HTML <script> tags.

export type ScriptLanguage = 'js' | 'jsx' | 'ts' | 'tsx';

/** A run of script inside a document, at `start` (a document offset). */
export interface ScriptRegion {
    start: number;
    text: string;
    language: ScriptLanguage;
}

const FENCE_LANGUAGES: Record<string, ScriptLanguage | 'html'> = {
    js: 'js', javascript: 'js', mjs: 'js', cjs: 'js', es6: 'js', jsx: 'jsx', javascriptreact: 'jsx',
    ts: 'ts', typescript: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', typescriptreact: 'tsx',
    html: 'html', htm: 'html', xhtml: 'html', shtml: 'html',
};

/** The script regions of a Markdown document: JS/TS code blocks, and <script> tags in HTML code blocks. */
export function markdownRegions(text: string): ScriptRegion[] {
    const regions: ScriptRegion[] = [];
    const fenceOpen = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`{]*)[^\n]*$/gm;
    let open: RegExpExecArray | null;
    while ((open = fenceOpen.exec(text))) {
        const [, fence, info] = open;
        const contentStart = Math.min(text.length, open.index + open[0].length + 1);
        // The closing fence: the same character, at least as long, on a line of its own
        const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*\\r?$`, 'gm');
        close.lastIndex = contentStart;
        const closing = close.exec(text);
        const contentEnd = closing ? closing.index : text.length;
        const kind = FENCE_LANGUAGES[info.toLowerCase()];
        const content = text.slice(contentStart, contentEnd);
        if (kind === 'html') {
            for (const region of htmlRegions(content)) regions.push({ ...region, start: contentStart + region.start });
        } else if (kind) {
            regions.push({ start: contentStart, text: content, language: kind });
        }
        fenceOpen.lastIndex = closing ? closing.index + closing[0].length : text.length;
    }
    return regions;
}

const SCRIPT_TYPES = /^(?:|module|text\/javascript|application\/javascript|text\/babel|text\/typescript)$/i;

/** The script regions of an HTML document: inline <script> tags that hold JavaScript. */
export function htmlRegions(text: string): ScriptRegion[] {
    const regions: ScriptRegion[] = [];
    const script = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let match: RegExpExecArray | null;
    while ((match = script.exec(text))) {
        const [whole, attributes, content] = match;
        if (/\bsrc\s*=/i.test(attributes)) continue;
        const type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
        const typeValue = type ? (type[1] ?? type[2] ?? type[3]) : '';
        if (!SCRIPT_TYPES.test(typeValue.trim())) continue;
        regions.push({ start: match.index + whole.indexOf('>') + 1, text: content, language: /typescript/i.test(typeValue) ? 'ts' : 'js' });
    }
    return regions;
}
