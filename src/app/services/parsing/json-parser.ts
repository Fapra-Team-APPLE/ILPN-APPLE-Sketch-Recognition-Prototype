import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {PetriNet} from '../../classes/diagram/diagram-types';
import {Coords, JsonPetriNet} from '../../classes/json-petri-net';
import {ParsingErrorMessage, sanitizeAndUniquifyIds} from './parsing-util';

export class JsonParser {

    static parse(text: string): PetriNet | ParsingErrorMessage {
        try {
            const rawData = JSON.parse(text) as JsonPetriNet;
            return JsonParser.processJson(rawData);
        } catch {
            return 'Invalid file format.';
        }
    }

    private static processJson(rawData: JsonPetriNet): PetriNet | ParsingErrorMessage {
        const rawPlaces = rawData['places'] || [];
        const rawTransitions = rawData['transitions'] || [];

        const rawNodes: Array<{id: string, label: string | undefined, type: 'place' | 'transition'}> = [];
        for (const rawPlace of rawPlaces) {
            rawNodes.push({id: rawPlace, label: rawData.labels?.[rawPlace], type: 'place'});
        }
        for (const rawTransition of rawTransitions) {
            rawNodes.push({id: rawTransition, label: rawData.labels?.[rawTransition], type: 'transition'});
        }

        const {newNodes, idMapping} = sanitizeAndUniquifyIds(rawNodes);

        const nodeMap = new Map<string, DiagramNode>();
        for (let i = 0; i < newNodes.length; i++) {
            const processed = newNodes[i];
            const original = rawNodes[i];
            const node = new DiagramNode(processed.id, original.type);
            if (processed.label) {
                node.setLabel(processed.label);
            }
            nodeMap.set(processed.id, node);
        }

        JsonParser.setPositions(nodeMap, rawData['layout'], idMapping);
        JsonParser.setMarking(nodeMap, rawData['marking'], idMapping);
        const edges = JsonParser.parseEdges(nodeMap, rawData['arcs'], rawData['layout'], idMapping);
        return new Diagram(Array.from(nodeMap.values()), edges);
    }

    private static setPositions(nodes: Map<string, DiagramNode>, layout: JsonPetriNet['layout'], idMapping: Map<string, string>) {
        if (!layout) {
            return;
        }
        for (const [oldId, posOrPts] of Object.entries(layout)) {
            const newId = idMapping.get(oldId);
            if (!newId) {
                continue;
            }
            const node = nodes.get(newId);
            if (!node) {
                continue;
            }
            const pos = posOrPts as Coords;
            if (typeof pos?.x === 'number' && typeof pos?.y === 'number') {
                node.setX(pos.x);
                node.setY(pos.y);
            }
        }
    }

    private static setMarking(nodes: Map<string, DiagramNode>, marking: JsonPetriNet['marking'], idMapping: Map<string, string>) {
        if (!marking) {
            return;
        }
        for (const [oldId, tokens] of Object.entries(marking)) {
            const newId = idMapping.get(oldId);
            if (!newId) {
                continue;
            }
            const node = nodes.get(newId);
            if (node) {
                node.tokenCount = tokens as number;
            }
        }
    }

    private static parseEdges(nodes: Map<string, DiagramNode>, arcs: JsonPetriNet['arcs'],
                              layout: JsonPetriNet['layout'], idMapping: Map<string, string>): Array<DiagramEdge<DiagramNode>> {
        const result: Array<DiagramEdge<DiagramNode>> = [];
        if (!arcs) {
            return result;
        }

        for (const [pair, weight] of Object.entries(arcs)) {
            const [srcId, dstId] = pair.split(',').map(s => s.trim());
            const srcNewId = idMapping.get(srcId);
            const dstNewId = idMapping.get(dstId);

            if (!srcNewId || !dstNewId) {
                continue;
            }

            const src = nodes.get(srcNewId);
            const dst = nodes.get(dstNewId);
            if (!src || !dst) {
                continue;
            }

            let waypoints: Array<Coords> = [];
            if (layout && Array.isArray(layout[pair])) {
                waypoints = (layout[pair] as Array<Coords>).map(c => ({x: c.x, y: c.y}));
            }

            result.push(new DiagramEdge(src, dst, weight as number, waypoints));
        }
        return result;
    }

}
