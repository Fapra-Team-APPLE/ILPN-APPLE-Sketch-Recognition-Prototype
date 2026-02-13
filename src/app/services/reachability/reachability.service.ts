import {Injectable} from '@angular/core';
import {Diagram} from '../../classes/diagram/diagram';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {DiagramValidity} from '../../classes/diagram/diagram-types';
import {ReachabilityEdge} from '../../classes/reachability/reachability-edge';
import {ReachabilityGraph} from '../../classes/reachability/reachability-graph';
import {Marking, ReachabilityNode} from '../../classes/reachability/reachability-node';

interface TransitionDefinition {
    id: string;
    label: string | undefined;
    inputs: Record<string, number>; // placeId -> weight
    outputs: Record<string, number>; // placeId -> weight
}

@Injectable({
    providedIn: 'root'
})
export class ReachabilityService {

    public findInitialNode(graph?: ReachabilityGraph): ReachabilityNode | undefined {
        if (!graph) {
            return undefined;
        }
        return graph.nodes.find(node => node.isInitialNode) ?? graph.nodes[0];
    }

    getPlaceIds(petriNet: Diagram): string[] {
        return petriNet.nodes.filter(n => n.kind === 'place').map(n => n.id);
    }

    buildInitialMarking(petriNet: Diagram<DiagramNode>, placeIds: string[]): Marking {
        const marking: Marking = {};
        const tokenProviders = new Map<string, DiagramNode>();
        for (const node of petriNet.nodes) {
            tokenProviders.set(node.id, node);
        }
        for (const placeId of placeIds) {
            const node = tokenProviders.get(placeId);
            marking[placeId] = node ? node.tokenCount : 0;
        }
        return marking;
    }


    buildTransitionTable(petriNet: Diagram): Map<string, TransitionDefinition> {
        const table = new Map<string, TransitionDefinition>();
        for (const node of petriNet.nodes) {
            if (node.kind === 'transition') {
                table.set(node.id, {id: node.id, label: node.label(), inputs: {}, outputs: {}});
            }
        }
        for (const edge of petriNet.edges) {
            const weight = edge.weight();
            if (edge.source.kind === 'place' && edge.target.kind === 'transition') {
                const definition = table.get(edge.target.id);
                if (definition) {
                    definition.inputs[edge.source.id] = (definition.inputs[edge.source.id] ?? 0) + weight;
                }
            } else if (edge.source.kind === 'transition' && edge.target.kind === 'place') {
                const definition = table.get(edge.source.id);
                if (definition) {
                    definition.outputs[edge.target.id] = (definition.outputs[edge.target.id] ?? 0) + weight;
                }
            }
        }
        return table;
    }

    fireTransition(marking: Marking, definition: TransitionDefinition, placeIds: string[]): Marking {
        const result: Marking = {};
        for (const placeId of placeIds) {
            let tokens = this.getTokens(marking, placeId, placeIds);
            if (tokens === 'w') {
                // Omega bleibt Omega
                result[placeId] = 'w';
                continue;
            }
            tokens -= definition.inputs[placeId] ?? 0;
            tokens += definition.outputs[placeId] ?? 0;
            result[placeId] = tokens;
        }
        return result;
    }

    getEnabledTransitions(marking: Marking, transitions: Map<string, TransitionDefinition>, placeIds: string[]): Set<TransitionDefinition> {
        const enabled = new Set<TransitionDefinition>();
        for (const definition of transitions.values()) {
            if (this.isTransitionEnabled(marking, definition, placeIds)) {
                enabled.add(definition);
            }
        }
        return enabled;
    }

    applyValidity(reachabilityGraph: ReachabilityGraph, nodeValidityMap: Map<string, DiagramValidity>,
                  nodeMarkingValidityMap: Map<string, Record<string, DiagramValidity>>, edgeValidityMap: Map<ReachabilityEdge, DiagramValidity>) {
        for (const node of reachabilityGraph.nodes) {
            node.setValidity(nodeValidityMap.get(node.id));
            node.setMarkingValidity(nodeMarkingValidityMap.get(node.id) ?? {});
        }
        for (const edge of reachabilityGraph.edges) {
            edge.setValidity(edgeValidityMap.get(edge));
        }
    }

    isTransitionEnabled(marking: Marking, definition: TransitionDefinition, placeIds: string[]): boolean {
        for (const [placeId, weight] of Object.entries(definition.inputs)) {
            const tokens = this.getTokens(marking, placeId, placeIds);
            if (tokens === 'w') { // Omega deckt jeden Bedarf
                continue;
            }
            if (tokens < weight) {
                return false;
            }
        }
        return true;
    }

    private getTokens(marking: Marking, placeId: string, placeIds: string[]): number | 'w' {
        if (!placeIds.includes(placeId)) {
            return 0;
        }
        const value = marking[placeId];
        if (value === undefined) {
            return 0;
        }
        return value;
    }


    validateNodeMarking(node: ReachabilityNode, expectedMarkings: Marking[], placeIds: string[]): {valid: boolean, markingValidity: Record<string, DiagramValidity>} {
        const markingValidity: Record<string, DiagramValidity> = {};
        let nodeValid = true;
        const marking = node.marking();

        for (const markedPlaceId of Object.keys(marking)) {
            if (!placeIds.includes(markedPlaceId)) {
                markingValidity[markedPlaceId] = {status: 'invalid', reasons: ['Marking contains too many entries']};
                nodeValid = false;
            }
        }

        for (const placeId of placeIds) {
            if (marking[placeId] === undefined) { // Fehlende Stelle im Marking
                markingValidity[placeId] = {status: 'invalid', reasons: ['Place missing in marking']};
                nodeValid = false;
                continue;
            }

            const actualValue = marking[placeId];
            let allMatch = true;
            for (const expectedMarking of expectedMarkings) {
                const expectedValue = expectedMarking[placeId] ?? 0;
                if (expectedValue !== actualValue) {
                    allMatch = false;
                    break;
                }
            }
            if (allMatch) {
                markingValidity[placeId] = {status: 'valid'};
            } else {
                markingValidity[placeId] = {status: 'invalid', reasons: ['Token count incorrect']};
                nodeValid = false;
            }
        }
        return {valid: nodeValid, markingValidity};
    }

    /**
     * Beschleunigung gemäß Theorem 2.2.3:
     * Findet unter den Vorgängern einen Zustand a, der von der neuen Markierung m komponentenweise dominiert wird (m >= a)
     * und mindestens eine Komponente strikt größer macht (m > a). Diese strikt größeren Komponenten werden zu 'w'.
     * Iterativ wiederholt, weil neu gesetzte 'w' weitere Dominanz ermöglichen können.
     */
    applyCoverabilityAcceleration(marking: Marking, ancestors: ReachabilityNode[], placeIds: string[]): Marking {
        const current = {...marking};
        let changed = true;
        while (changed) {
            changed = false;
            for (const ancestor of ancestors) {
                const ancestorMark = ancestor.marking();
                const domination = this.getDominationRelation(current, ancestorMark, placeIds);
                if (domination.dominates && domination.strictlyGreater) {
                    for (const placeId of domination.strictlyGreaterPlaces) {
                        if (current[placeId] !== 'w') {
                            current[placeId] = 'w';
                            changed = true;
                        }
                    }
                }
            }
        }
        return current;
    }

    private getDominationRelation(marking: Marking, a: Marking, placeIds: string[]): {dominates: boolean; strictlyGreater: boolean; strictlyGreaterPlaces: string[]} {
        let dominates = true;
        let strictlyGreater = false;
        const greaterPlaces: string[] = [];
        for (const placeId of placeIds) {
            const markingValue = marking[placeId] ?? 0;
            const valueA = a[placeId] ?? 0;
            if (markingValue === 'w') {
                if (valueA === 'w') {
                    // gleich
                } else {
                    strictlyGreater = true;
                    greaterPlaces.push(placeId);
                }
            } else if (valueA === 'w') {
                // marking kann a nicht dominieren
                dominates = false;
                break;
            } else {
                if (markingValue < valueA) {
                    dominates = false;
                    break;
                }
                if (markingValue > valueA) {
                    strictlyGreater = true;
                    greaterPlaces.push(placeId);
                }
            }
        }
        return {dominates, strictlyGreater, strictlyGreaterPlaces: strictlyGreater ? greaterPlaces : []};
    }

    markingKey(marking: Marking, placeIds: string[]): string {
        return placeIds.map(pid => {
            const value = marking[pid];
            if (value === undefined) {
                return 'X'; // Missing entry - distinct from 0
            }
            return value === 'w' ? 'w' : String(value);
        }).join('|');
    }

}
