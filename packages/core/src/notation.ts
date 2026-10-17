// Printing tree notation as JavaScript, for hovers.

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const WIDTH = 80;

/** `value` as JavaScript source: single-quoted strings, unknowns as ‹text›, wrapped at 80 columns. */
export function printNotation(value: unknown, indent = ''): string {
    const inline = printInline(value);
    if (inline.length + indent.length <= WIDTH || !value || typeof value !== 'object' || isUnknown(value)) return inline;
    const inner = `${indent}    `;
    if (Array.isArray(value)) {
        // An element specification hugs its last item, as hand-written: ['ul', {}, [ …children… ]]
        const last = value[value.length - 1];
        const head = value.slice(0, -1).map(printInline).join(', ');
        if (isElementSpec(value) && value.length > 1 && last && typeof last === 'object' && indent.length + head.length + 4 <= WIDTH) {
            return `[${head}, ${printNotation(last, indent)}]`;
        }
        return `[\n${value.map(item => `${inner}${printNotation(item, inner)},`).join('\n')}\n${indent}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    return `{\n${entries.map(([key, item]) => `${inner}${printKey(key)}: ${printNotation(item, inner)},`).join('\n')}\n${indent}}`;
}

function printInline(value: unknown): string {
    if (typeof value === 'string') return quote(value);
    if (value === undefined) return 'undefined';
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'function') return value.name || '‹function›';
    if (isUnknown(value)) return value.toJSON();
    if (Array.isArray(value)) return `[${value.map(printInline).join(', ')}]`;
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        return entries.length ? `{ ${entries.map(([key, item]) => `${printKey(key)}: ${printInline(item)}`).join(', ')} }` : '{}';
    }
    return String(value);
}

/** [tag | { tag, ish }, pattern?, children | repeat?] */
function isElementSpec(value: unknown[]): boolean {
    const [header] = value;
    return value.length <= 3 && (typeof header === 'string' || (!!header && typeof header === 'object' && 'tag' in header));
}

function printKey(key: string): string {
    return IDENTIFIER.test(key) ? key : quote(key);
}

function quote(text: string): string {
    return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/** A TreeUnknown from any copy of assign-gingerly (bundled or the workspace's). */
function isUnknown(value: unknown): value is { toJSON(): string } {
    return !!value && typeof value === 'object' && value.constructor?.name === 'TreeUnknown'
        && typeof (value as { toJSON?: unknown }).toJSON === 'function';
}
