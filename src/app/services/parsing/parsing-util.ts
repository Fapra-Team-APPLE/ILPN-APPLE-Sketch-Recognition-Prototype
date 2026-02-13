export type ParsingErrorMessage = string;

// Wegen der Petri Net Definition Syntax sind folgende Zeichen reserviert: Leerzeichen, Komma, Klammern, Pluszeichen, geschweifte Klammern, Multiplikationszeichen (×, ⋅, x)
const RESERVED_CHARS_REGEX = /[\s,()+{}]|[x\u22C5\u00D7]/gu;

export function sanitizeString(s: string): string {
    return s.replace(RESERVED_CHARS_REGEX, '_');
}

/**
 * Bereinigt IDs und Labels und stellt deren Eindeutigkeit sicher.
 * IDs und Labels teilen sich den Namensraum für die Eindeutigkeitsprüfung.
 * Gibt ein Mapping von alter ID zu neuer ID zurück.
 */
export function sanitizeAndUniquifyIds(
    rawNodes: Array<{ id: string, label?: string }>
): { newNodes: Array<{ id: string, label: string | undefined }>, idMapping: Map<string, string> } {
    const idMapping = new Map<string, string>();
    const usedIds = new Set<string>();
    const newNodes: Array<{ id: string, label: string | undefined }> = [];

    // 1. IDs verarbeiten (IDs müssen eindeutig sein)
    for (const node of rawNodes) {
        let newId = sanitizeString(node.id);
        if (newId === '') {
            newId = '_';
        }

        const originalBase = newId;
        let counter = 1;
        while (usedIds.has(newId)) {
            newId = `${originalBase}_${counter}`;
            counter++;
        }

        usedIds.add(newId);
        idMapping.set(node.id, newId);

        newNodes.push({id: newId, label: node.label});
    }

    // 2. Labels verarbeiten (Effective Labels müssen eindeutig sein)
    const usedEffectiveLabels = new Set<string>();
    for (const node of newNodes) {
        const hasExplicitLabel = !!node.label;

        if (hasExplicitLabel) {
            let candidate = sanitizeString(node.label!);
            if (candidate === '') {
                candidate = '_';
            }

            const originalBase = candidate;
            let counter = 1;
            while (usedEffectiveLabels.has(candidate)) {
                candidate = `${originalBase}_${counter}`;
                counter++;
            }
            usedEffectiveLabels.add(candidate);
            node.label = candidate;
        } else {
            // Kein explizites Label -> effectiveLabel ist die ID
            // IDs sind bereits eindeutig, also einfach als used markieren
            usedEffectiveLabels.add(node.id);
        }
    }

    return {newNodes, idMapping};
}


export function checkIdValidity(places: string[], transitions: string[]): ParsingErrorMessage | undefined {
    const invalidPlace = findInvalidIdContainingWhitespaces(places);
    if (invalidPlace) {
        return `Illegal whitespace in Place ID "${invalidPlace}".`;
    }
    const invalidTransition = findInvalidIdContainingWhitespaces(transitions);
    if (invalidTransition) {
        return `Illegal whitespace in Transition ID "${invalidTransition}".`;
    }
    return undefined;
}

function findInvalidIdContainingWhitespaces(ids: string[]): string | null {
    for (const id of ids) {
        if (hasWhitespace(id)) {
            return id;
        }
    }
    return null;
}

function hasWhitespace(id: string): boolean {
    return /\s/.test(id);
}
