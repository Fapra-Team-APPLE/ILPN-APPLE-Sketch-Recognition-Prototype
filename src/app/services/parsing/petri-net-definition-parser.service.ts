import {Injectable} from '@angular/core';
import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {PetriNet} from '../../classes/diagram/diagram-types';
import {LayoutService} from '../layout.service';
import {checkIdValidity, ParsingErrorMessage, sanitizeAndUniquifyIds} from './parsing-util';

@Injectable({
    providedIn: 'root'
})
export class PetriNetDefinitionParserService {

    /**
     * Erwartetes Format:
     * ({p1, p2, ...}, {t1, t2, ...}, (a,b) + (b,c) + ..., pX + pY + ...)
     */
    constructor(private layoutService: LayoutService) {
    }

    public parse(text: string | null | undefined): PetriNet | ParsingErrorMessage | undefined {
        try {
            if (text === undefined || text === null) {
                return undefined;
            }
            const src = String(text).trim();
            if (src.length === 0) {
                return undefined;
            }

            const trimmed = this.unwrapIf(src, '(', ')').trim();

            // 1) Erstes {..} => Places, zweites {..} => Transitions
            let nextCharacterIndex = 0;
            const placesBlock = this.extractBalanced(trimmed, '{', '}', nextCharacterIndex);
            if (!placesBlock) {
                return undefined;
            }
            nextCharacterIndex = placesBlock.nextIndex;

            const transitionsBlock = this.extractBalanced(trimmed, '{', '}', nextCharacterIndex);
            if (!transitionsBlock) {
                return undefined;
            }
            nextCharacterIndex = transitionsBlock.nextIndex;

            const rawPlaces = this.parseIdList(placesBlock.content);
            const rawTransitions = this.parseIdList(transitionsBlock.content);

            const errorMessage = checkIdValidity(rawPlaces, rawTransitions);
            if (errorMessage) {
                return errorMessage;
            }

            const rawNodes: Array<{id: string, label?: string, type: 'place' | 'transition'}> = [];
            for (const rawPlace of rawPlaces) {
                rawNodes.push({id: rawPlace, type: 'place'});
            }
            for (const rawTransition of rawTransitions) {
                rawNodes.push({id: rawTransition, type: 'transition'});
            }

            const {newNodes, idMapping} = sanitizeAndUniquifyIds(rawNodes);

            // 2) Arcs: Folge von (a,b) + (c,d) ... optional mit Multiplizität: "<Zahl> <x/⋅/×> (a,b)"
            const arcs: Array<[string, string, number]> = [];
            let nextArcCharacterIndex = nextCharacterIndex;
            while (true) {
                // Skip Trenner zwischen Kanten
                while (nextArcCharacterIndex < trimmed.length
                && (trimmed[nextArcCharacterIndex] === '+' || trimmed[nextArcCharacterIndex] === ' ' || trimmed[nextArcCharacterIndex] === ',')) {
                    nextArcCharacterIndex++;
                }

                const openPos = trimmed.indexOf('(', nextArcCharacterIndex);
                if (openPos < 0) {
                    break;
                }

                // Präfix zwischen aktuellem Index und '(' auswerten -> Multiplizität
                const prefix = trimmed.substring(nextArcCharacterIndex, openPos);
                const multiplicity = this.parseMultiplicityOrDefault(prefix);
                if (multiplicity === null) {
                    return undefined;
                }

                // eigentliche Kante auslesen
                const arc = this.extractBalanced(trimmed, '(', ')', nextArcCharacterIndex);
                if (!arc) {
                    return undefined;
                }
                const pair = arc.content.split(',').map(s => s.trim());
                if (pair.length !== 2 || pair[0].length === 0 || pair[1].length === 0) {
                    return undefined;
                }

                const srcId = idMapping.get(pair[0]);
                const dstId = idMapping.get(pair[1]);
                if (srcId && dstId) {
                    arcs.push([srcId, dstId, multiplicity]);
                }
                nextArcCharacterIndex = arc.nextIndex;
            }

            // 3) Marking: Rest nach letztem ')' und ',' -> split per '+'
            let markingStr = trimmed.substring(nextArcCharacterIndex).trim();
            if (markingStr.startsWith(',')) {
                markingStr = markingStr.substring(1).trim();
            }

            const markingCount = new Map<string, number>();
            if (markingStr.length > 0) {
                const terms = markingStr.split('+');
                for (const rawTerm of terms) {
                    const term = rawTerm.trim();
                    if (!term) {
                        continue;
                    }
                    const parsed = this.parseMarkingTerm(term);
                    if (parsed === null) {
                        return undefined;
                    }
                    const {id: rawId, multiplicity} = parsed;
                    const newId = idMapping.get(rawId);
                    if (newId) {
                        markingCount.set(newId, (markingCount.get(newId) ?? 0) + multiplicity);
                    }
                }
            }

            // Knoten anlegen
            const nodeMap = new Map<string, DiagramNode>();
            for (let i = 0; i < newNodes.length; i++) {
                const processed = newNodes[i];
                const original = rawNodes[i];
                nodeMap.set(processed.id, new DiagramNode(processed.id, original.type));
            }

            // Token setzen
            for (const [placeId, tokenCount] of markingCount.entries()) {
                const place = nodeMap.get(placeId);
                if (place) {
                    place.tokenCount = tokenCount;
                }
            }

            // Edges anlegen
            const edges: DiagramEdge<DiagramNode>[] = [];
            for (const [a, b, w] of arcs) {
                const srcNode = nodeMap.get(a);
                const dstNode = nodeMap.get(b);
                if (srcNode && dstNode) {
                    // Überprüfe, dass Transitionen nur mit Stellen verbunden sind (und umgekehrt)
                    if (srcNode.kind === dstNode.kind) {
                        return undefined;
                    }
                    edges.push(new DiagramEdge(srcNode, dstNode, w > 0 ? w : 1, []));
                }
            }

            const diagram = new Diagram(Array.from(nodeMap.values()), edges);

            return diagram;
        } catch {
            return 'Parsing failed due to an unexpected error.';
        }
    }

    // ---------------- Drawing als Petrinetz-Definition -----------
    public toDefinition(diagram: PetriNet | null | undefined): string {
        if (!diagram) {
            return '({},{})';
        }
        // Notation kompatibel zum Parser: ({places},{transitions},arcs,marking)
        // effectiveLabel() wird genutzt, damit bei umbenannten Nodes die Labels verwendet werden.
        const places = diagram.nodes.filter(node => node.kind === 'place').map(node => node.effectiveLabel());
        const transitions = diagram.nodes.filter(node => node.kind === 'transition').map(node => node.effectiveLabel());
        // Kanten werden inklusive Multiplizität serialisiert -> bildet die "2x(...)"-Syntax des Parsers ab
        const arcs = diagram.edges.map(edge => {
            const weight = edge.weight();
            const prefix = weight > 1 ? `${weight}x` : '';
            return `${prefix}(${edge.source.effectiveLabel()},${edge.target.effectiveLabel()})`;
        });
        // Markierung entspricht der Tokenanzahl je Stelle
        // nur >0 wird ausgegeben, um Eingabe kurz zu halten.
        const marking = diagram.nodes
            .filter(node => node.kind === 'place')
            .filter(p => p.tokenCount > 0)
            .map(p => {
                const tokens = p.tokenCount;
                return tokens > 1 ? `${tokens}x${p.effectiveLabel()}` : p.effectiveLabel();
            });

        const markingStr = marking.join('+');

        const arcsStr = arcs.join('+');

        return `({${places.join(',')}},{${transitions.join(',')}}${arcsStr ? `,${arcsStr}` : ''}${markingStr ? `,${markingStr}` : ''})`;
    }

    private parseIdList(blockContent: string): string[] {
        return blockContent
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }

    private extractBalanced(src: string, open: string, close: string, startIndex: number = 0): {content: string, nextIndex: number} | undefined {
        let i = src.indexOf(open, startIndex);
        if (i < 0) {
            return undefined;
        }
        let depth = 0;
        let start = -1;
        for (; i < src.length; i++) {
            const currentChar = src[i];
            if (currentChar === open) {
                depth++;
                if (depth === 1) {
                    start = i + 1;
                }
            } else if (currentChar === close) {
                depth--;
                if (depth === 0) {
                    return {
                        content: src.substring(start, i),
                        nextIndex: i + 1
                    };
                }
            }
        }
        return undefined;
    }

    private unwrapIf(text: string, open: string, close: string): string {
        const trimmed = text.trim();
        if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
            return trimmed.substring(1, trimmed.length - 1);
        }
        return text;
    }

    /**
     * Multiplizität vor einer Kante: erlaubt ist nur "<Zahl><Symbol>" (Symbol: x, ⋅, ×) oder leer (implizit 1).
     */
    private parseMultiplicityOrDefault(prefix: string): number | null {
        const trimmed = prefix.trim();
        if (trimmed.length === 0) {
            return 1;
        }
        const m = /^(\d+)\s*[x\u22C5\u00D7]\s*$/u.exec(trimmed);
        if (!m) {
            return null;
        }
        const num = parseInt(m[1], 10);
        return num > 0 ? num : null;
    }

    /**
     * Parst entweder eine reine ID ("p2") oder "<Zahl><Symbol><ID>" mit Symbol x/⋅/×, z. B. "2×p2" oder "2 x p2".
     */
    private parseMarkingTerm(term: string): {id: string, multiplicity: number} | null {
        const t = term.trim();
        // Zuerst das Multiplikationsmuster versuchen
        const multMatch = /^\s*(\d+)\s*[x\u22C5\u00D7]\s*(.+?)\s*$/u.exec(t);
        if (multMatch) {
            const mult = parseInt(multMatch[1], 10);
            const id = (multMatch[2] ?? '').trim();
            if (!id || mult <= 0) {
                return null;
            }
            return {id, multiplicity: mult};
        }
        // Wenn ein Symbol vorhanden ist, war es fehlerhaft (z. B. nur "× p3" ohne Zahl)
        if (/[x\u22C5\u00D7]/u.test(t)) {
            return null;
        }
        if (!t) {
            return null;
        }
        return {id: t, multiplicity: 1};
    }

}
