// Checks that need the type checker (the TS plugin, the CLI): .prop names against the element's
// type, @event names against the standard events, and ish=${…} being a class or a name.

import type * as TS from 'typescript';
import type { FileAnalysis } from './analyze.ts';
import type { TemplateSite } from './templates.ts';
import { Codes, type Finding, type TreeTemplateElement, type Typescript } from './types.ts';

export function typeChecks(ts: Typescript, checker: TS.TypeChecker, file: FileAnalysis): Finding[] {
    const { sf, results } = file;
    const globals = checker.getSymbolsInScope(sf, ts.SymbolFlags.Interface);
    const declared = (name: string) => {
        const symbol = globals.find(candidate => candidate.name === name);
        return symbol && checker.getDeclaredTypeOfSymbol(symbol);
    };
    const tagMap = declared('HTMLElementTagNameMap');
    const eventMap = declared('HTMLElementEventMap');
    if (!tagMap) return [];

    const findings: Finding[] = [];
    const elementType = (tag: string) => {
        const property = checker.getPropertyOfType(tagMap, tag);
        return property && checker.getTypeOfSymbolAtLocation(property, sf);
    };
    const check = (site: TemplateSite, element: TreeTemplateElement): void => {
        const type = elementType(element.tag);
        for (const { name, location, hole } of element.attributes) {
            const start = site.parts[location.part]?.toSource(location.offset);
            if (start === undefined) continue;
            if (name.startsWith('.') && type) {
                // A nested path (.style.color) is checked by its first segment
                const prop = /^[^.?\s]+/.exec(name.slice(1))?.[0];
                if (prop && !checker.getPropertyOfType(type, prop)) {
                    findings.push({
                        start: start + 1, length: prop.length, severity: 'warning', code: Codes.unknownProperty,
                        message: `Property '${prop}' doesn't exist on <${element.tag}> (${checker.typeToString(type)}).`,
                    });
                }
            } else if (name.startsWith('@') && type && eventMap) {
                const event = name.slice(1);
                if (!checker.getPropertyOfType(eventMap, event)) {
                    findings.push({
                        start: start + 1, length: event.length, severity: 'suggestion', code: Codes.unknownEvent,
                        message: `'${event}' isn't a standard event of <${element.tag}>. (Fine for a custom event.)`,
                    });
                }
            } else if (name === 'ish' && hole !== undefined) {
                const expression = site.holes[hole];
                const valueType = checker.getTypeAtLocation(expression);
                const ok = valueType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.StringLike)
                    || valueType.getConstructSignatures().length > 0;
                if (!ok) {
                    findings.push({
                        start: expression.getStart(sf), length: expression.end - expression.getStart(sf), severity: 'warning', code: Codes.ishNotManager,
                        message: `ish expects a manager class or a registered name, not ${checker.typeToString(valueType)}.`,
                    });
                }
            }
        }
        for (const child of element.children) check(site, child);
    };
    for (const { site, analysis } of results) {
        for (const element of analysis.elements) check(site, element);
    }
    return findings;
}

/** Whether an identifier is a paths() proxy, by its type (`PathProxy<…>`). */
export function isPathProxy(checker: TS.TypeChecker, id: TS.Identifier): boolean {
    const type = checker.getTypeAtLocation(id);
    const name = type.aliasSymbol?.name ?? type.getSymbol()?.name;
    return name === 'PathProxy' || name === 'PathProxyCore';
}
