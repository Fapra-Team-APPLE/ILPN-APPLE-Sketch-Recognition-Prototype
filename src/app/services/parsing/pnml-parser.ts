import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {PetriNet} from '../../classes/diagram/diagram-types';
import {Coords} from '../../classes/json-petri-net';
import {ParsingErrorMessage, sanitizeAndUniquifyIds} from './parsing-util';

export class PnmlParser {

    static parse(text: string): PetriNet | ParsingErrorMessage {
        const parser = new DOMParser();
        const xmlDocument = parser.parseFromString(text, 'text/xml');

        const parserError = xmlDocument.querySelector('parsererror');
        if (parserError) {
            return 'Invalid PNML format.';
        }

        const nodeMap = new Map<string, DiagramNode>();

        const placeElements = Array.from(xmlDocument.getElementsByTagName('place'));
        const rawPlaces = PnmlParser.extractPnmlPlaces(placeElements);

        const transitionElements = Array.from(xmlDocument.getElementsByTagName('transition'));
        const rawTransitions = PnmlParser.extractPnmlTransitions(transitionElements);

        const rawNodes = [...rawPlaces, ...rawTransitions];
        const {newNodes, idMapping} = sanitizeAndUniquifyIds(rawNodes);

        for (let i = 0; i < newNodes.length; i++) {
            const processed = newNodes[i];
            const original = rawNodes[i];

            const node = new DiagramNode(processed.id, original.type);
            if (original.x !== undefined && original.y !== undefined) {
                node.setX(original.x);
                node.setY(original.y);
            }

            if (processed.label) {
                node.setLabel(processed.label);
            }
            if (original.type === 'place' && original.tokenCount !== undefined) {
                node.tokenCount = original.tokenCount;
            }
            nodeMap.set(processed.id, node);
        }

        const arcElements = Array.from(xmlDocument.getElementsByTagName('arc'));
        const edges = PnmlParser.parsePnmlArcElements(arcElements, nodeMap, idMapping);

        return new Diagram(Array.from(nodeMap.values()), edges);
    }

    private static extractPnmlTransitions(transitionElements: Element[]): Array<{id: string, type: 'transition', x?: number, y?: number, label?: string}> {
        const transitions: Array<{id: string, type: 'transition', x?: number, y?: number, label?: string}> = [];
        for (const transitionElement of transitionElements) {
            const id = transitionElement.getAttribute('id');
            if (!id) {
                continue;
            }

            const transitionData: {id: string, type: 'transition', x?: number, y?: number, label?: string} = {id, type: 'transition'};
            const pos = PnmlParser.getPnmlNodePosition(transitionElement);
            if (pos) {
                transitionData.x = pos.x;
                transitionData.y = pos.y;
            }

            const nameText = PnmlParser.extractPnmlText(transitionElement, 'name');
            if (nameText) {
                transitionData.label = nameText;
            }
            transitions.push(transitionData);
        }
        return transitions;
    }

    private static extractPnmlPlaces(placeElements: Element[]) : Array<{id: string, type: 'place', x?: number, y?: number, tokenCount?: number, label?: string}> {
        const places: Array<{id: string, type: 'place', x?: number, y?: number, tokenCount?: number, label?: string}> = [];
        for (const placeElement of placeElements) {
            const id = placeElement.getAttribute('id');
            if (!id) {
                continue;
            }

            const placeData: {id: string, type: 'place', x?: number, y?: number, tokenCount?: number, label?: string} = {id, type: 'place'};
            const pos = PnmlParser.getPnmlNodePosition(placeElement);
            if (pos) {
                placeData.x = pos.x;
                placeData.y = pos.y;
            }

            const nameText = PnmlParser.extractPnmlText(placeElement, 'name');
            if (nameText) {
                placeData.label = nameText;
            }

            const markingText = PnmlParser.extractPnmlText(placeElement, 'initialMarking');
            if (markingText) {
                const tokens = parseInt(markingText, 10);
                if (!isNaN(tokens)) {
                    placeData.tokenCount = tokens;
                }
            }
            places.push(placeData);
        }
        return places;
    }

    private static parsePnmlArcElements(arcElements: Element[], nodeMap: Map<string, DiagramNode>, idMapping: Map<string, string>): DiagramEdge<DiagramNode>[] {
        const edges: DiagramEdge<DiagramNode>[] = [];
        for (const arcElement of arcElements) {
            const rawSourceId = arcElement.getAttribute('source');
            const rawTargetId = arcElement.getAttribute('target');
            if (!rawSourceId || !rawTargetId) {
                continue;
            }

            const sourceId = idMapping.get(rawSourceId);
            const targetId = idMapping.get(rawTargetId);

            if (!sourceId || !targetId) {
                continue;
            }

            const source = nodeMap.get(sourceId);
            const target = nodeMap.get(targetId);
            if (!source || !target) {
                continue;
            }

            let effectiveWeight = 1;
            const inscriptionText = PnmlParser.extractPnmlText(arcElement, 'inscription');
            if (inscriptionText) {
                const weight = parseInt(inscriptionText, 10);
                if (!isNaN(weight)) {
                    effectiveWeight = weight;
                }
            }

            const waypoints: Coords[] = [];
            const graphics = arcElement.getElementsByTagName('graphics')[0];
            if (graphics) {
                const positions = Array.from(graphics.getElementsByTagName('position'));
                for (const pos of positions) {
                    waypoints.push({
                        x: parseFloat(pos.getAttribute('x') || '0'),
                        y: parseFloat(pos.getAttribute('y') || '0')
                    });
                }
            }

            edges.push(new DiagramEdge(source, target, effectiveWeight, waypoints));
        }
        return edges;
    }


    private static getPnmlNodePosition(parent: Element): {x: number, y: number} | null {
        const graphics = parent.getElementsByTagName('graphics')[0];
        const position = graphics?.getElementsByTagName('position')[0];
        if (position) {
            return {
                x: parseFloat(position.getAttribute('x') || '0'),
                y: parseFloat(position.getAttribute('y') || '0')
            };
        }
        return null;
    }

    private static extractPnmlText(parent: Element, tagName: string): string | null {
        const el = parent.getElementsByTagName(tagName)[0];
        return el?.getElementsByTagName('text')[0]?.textContent || null;
    }

}
