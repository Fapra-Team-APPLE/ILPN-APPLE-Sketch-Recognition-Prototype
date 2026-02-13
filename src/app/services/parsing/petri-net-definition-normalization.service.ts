import {Injectable} from '@angular/core';
import {PetriNet} from '../../classes/diagram/diagram-types';
import {ParsingErrorMessage} from './parsing-util';
import {PetriNetDefinitionParserService} from './petri-net-definition-parser.service';

@Injectable({providedIn: 'root'})
export class PetriNetDefinitionNormalizationService {

    constructor(private parser: PetriNetDefinitionParserService) {
    }

    normalize(definition: string | null | undefined): string | ParsingErrorMessage | undefined {
        const parsed = this.parser.parse(definition);

        if (parsed === undefined) {
            return undefined;
        }
        if (typeof parsed === 'string') {
            return parsed; // ParsingErrorMessage
        }

        return this.toCanonicalDefinition(parsed);
    }

    private toCanonicalDefinition(diagram: PetriNet): string {
        const places = diagram.nodes
            .filter(n => n.kind === 'place')
            .map(n => n.effectiveLabel())
            .sort();

        const transitions = diagram.nodes
            .filter(n => n.kind === 'transition')
            .map(n => n.effectiveLabel())
            .sort();

        const arcs = diagram.edges
            .map(e => {
                const w = e.weight();
                const prefix = w > 1 ? `${w}x` : '';
                return `${prefix}(${e.source.effectiveLabel()},${e.target.effectiveLabel()})`;
            })
            .sort();

        const marking = diagram.nodes
            .filter(n => n.kind === 'place')
            .filter(p => p.tokenCount > 0)
            .map(p => {
                const tokens = p.tokenCount;
                const label = p.effectiveLabel();
                return tokens > 1 ? `${tokens}x${label}` : label;
            })
            .sort();

        const arcsStr = arcs.join('+');
        const markingStr = marking.join('+');

        return `({${places.join(',')}},{${transitions.join(',')}}${arcsStr ? `,${arcsStr}` : ''}${markingStr ? `,${markingStr}` : ''})`;
    }

}
