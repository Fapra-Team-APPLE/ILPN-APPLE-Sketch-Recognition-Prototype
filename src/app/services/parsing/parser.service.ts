import {Injectable} from '@angular/core';
import {PetriNet} from '../../classes/diagram/diagram-types';
import {LayoutFrame, LayoutService} from '../layout.service';
import {JsonParser} from './json-parser';
import {ParsingErrorMessage} from './parsing-util';
import {PnmlParser} from './pnml-parser';

@Injectable({
    providedIn: 'root'
})
export class ParserService {

    // Der Layout-Service wird injiziert, damit eingehende Netze automatisch schön angeordnet werden können.
    constructor(private layoutService: LayoutService) {
    }

    parse(text: string, widthForLayouting?: number): PetriNet | ParsingErrorMessage | null {
        let result: PetriNet | ParsingErrorMessage;
        if (text.trim().startsWith('<')) {
            result = PnmlParser.parse(text);
        } else {
            result = JsonParser.parse(text);
        }

        if (typeof result === 'string') {
            return result;
        }

        const diagram = result;
        const hasUnpositionedNodes = diagram.nodes.some(n => n.x() === 0 || n.y() === 0);
        if (hasUnpositionedNodes && diagram.nodes.length > 0) {
            // Falls das Input keine Koordinaten enthält -> Force-Layout anwenden.
            // Entstehende Frames landen im Diagramm -> DisplayComponent kann sofort eine Animation abspielen.
            const frames: LayoutFrame[] = [];
            this.layoutService.applyForceDirectedLayout(diagram, {frames, width: widthForLayouting});
        }

        return diagram;
    }

}
