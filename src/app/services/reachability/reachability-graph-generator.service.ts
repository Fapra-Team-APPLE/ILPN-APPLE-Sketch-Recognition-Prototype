import {inject, Injectable} from '@angular/core';
import {Diagram} from '../../classes/diagram/diagram';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {ReachabilityEdge} from '../../classes/reachability/reachability-edge';
import {ReachabilityGraph} from '../../classes/reachability/reachability-graph';
import {ReachabilityNode} from '../../classes/reachability/reachability-node';
import {ReachabilityService} from './reachability.service';

@Injectable({
    providedIn: 'root'
})
export class ReachabilityGraphGeneratorService {

    private readonly reachabilityService = inject(ReachabilityService);

    /** Konfigurationsparameter für die Graph-Generierung */
    private static readonly DEFAULT_MAX_NODES = 2000;

    /**
     * Erzeugt einen Erreichbarkeits- oder Überdeckungsgraphen.
     * coverability = true berechnet den Überdeckungsgraphen.
     */
    generateReachabilityGraph(petriNet: Diagram<DiagramNode>, options: { coverability?: boolean; maxNodes?: number } = {}): ReachabilityGraph {
        const {coverability = true, maxNodes = ReachabilityGraphGeneratorService.DEFAULT_MAX_NODES} = options;
        const placeIds = this.reachabilityService.getPlaceIds(petriNet);
        if (placeIds.length === 0) {
            return new ReachabilityGraph([], []);
        }
        const transitions = this.reachabilityService.buildTransitionTable(petriNet);
        const initialMarking = this.reachabilityService.buildInitialMarking(petriNet, placeIds);

        const initialNode = new ReachabilityNode('s0', initialMarking);
        initialNode.setActivated(true);

        // 𝑀, 𝐸 ← ∅
        const nodes: ReachabilityNode[] = [initialNode];
        const edges: ReachabilityEdge[] = [];

        // Markierungsschlüssel für schnelle Wiedererkennung
        const visited = new Map<string, ReachabilityNode>();
        visited.set(this.reachabilityService.markingKey(initialMarking, placeIds), initialNode);

        const queue: QueueItem[] = [{node: initialNode, ancestors: []}]; // 𝑄 ← {𝑚0}
        while (queue.length > 0 && nodes.length < maxNodes) { // WHILE 𝑄 ≠ ∅ DO
            const currentItem = queue.shift()!; // CHOOSE 𝑚 ∈ 𝑄  und   𝑄 ← 𝑄\ {𝑚}
            const currentNode = currentItem.node;
            const enabledTransitions = this.reachabilityService.getEnabledTransitions(currentNode.marking(), transitions, placeIds);

            for (const transition of enabledTransitions) {
                let successorMarking = this.reachabilityService.fireTransition(currentNode.marking(), transition, placeIds);

                if (coverability) {
                    successorMarking = this.reachabilityService.applyCoverabilityAcceleration(successorMarking, [...currentItem.ancestors, currentNode], placeIds);
                }

                const key = this.reachabilityService.markingKey(successorMarking, placeIds);
                let successorNode = visited.get(key);
                if (!successorNode) { // deckt folgenden Schritt effizienter ab: 𝑄 ← 𝑄 \ 𝑀
                    const newId = `s${nodes.length}`;
                    successorNode = new ReachabilityNode(newId, successorMarking);
                    nodes.push(successorNode); // 𝑀 ← 𝑀 ∪ {𝑚}
                    visited.set(key, successorNode);
                    queue.push({node: successorNode, ancestors: [...currentItem.ancestors, currentNode]}); // 𝑄 ← 𝑄 ∪ {𝑚‘}
                }
                edges.push(new ReachabilityEdge(currentNode, successorNode, transition.label ?? transition.id)); // 𝐸 ← 𝐸 ∪ {(𝑚, 𝑡, 𝑚‘)}
            }
        }

        return new ReachabilityGraph(nodes, edges); // OUTPUT (𝑀, 𝐸, 𝑚0
    }

    performStep(
        graph: ReachabilityGraph,
        sourceNode: ReachabilityNode,
        transitionLabel: string,
        petriNet: Diagram<DiagramNode>
    ): {graph: ReachabilityGraph, newNode: ReachabilityNode} | null {
        const placeIds = this.reachabilityService.getPlaceIds(petriNet);
        const transitions = this.reachabilityService.buildTransitionTable(petriNet);
        const transition = Array.from(transitions.values()).find(t => (t.label || t.id) === transitionLabel);

        if (!transition) {
            console.error('Transition not found', transitionLabel);
            return null;
        }

        const newMarking = this.reachabilityService.fireTransition(sourceNode.marking(), transition, placeIds);

        // Ancestors für Coverability finden (Rückwärtssuche im Graphen)
        const ancestors = this.findAncestors(graph, sourceNode);
        const acceleratedMarking = this.reachabilityService.applyCoverabilityAcceleration(newMarking, ancestors, placeIds);

        const key = this.reachabilityService.markingKey(acceleratedMarking, placeIds);
        const existingNode = graph.nodes.find(n => this.reachabilityService.markingKey(n.marking(), placeIds) === key);

        if (existingNode) {
            // Kante hinzufügen wenn noch nicht existiert
            const existingEdge = graph.edges.find(e => e.source === sourceNode && e.target === existingNode && e.label() === transitionLabel);
            if (!existingEdge) {
                const newEdge = new ReachabilityEdge(sourceNode, existingNode, transitionLabel);
                return {
                    graph: new ReachabilityGraph(graph.nodes, [...graph.edges, newEdge]),
                    newNode: existingNode
                };
            }
            return {graph, newNode: existingNode};
        } else {
            const newNode = new ReachabilityNode(this.getNextStateNodeId(graph), acceleratedMarking);
            const newEdge = new ReachabilityEdge(sourceNode, newNode, transitionLabel);
            return {
                graph: new ReachabilityGraph([...graph.nodes, newNode], [...graph.edges, newEdge]),
                newNode: newNode
            };
        }
    }

    private findAncestors(graph: ReachabilityGraph, node: ReachabilityNode): ReachabilityNode[] {
        const ancestors = new Set<ReachabilityNode>();
        const queue = [node];
        const visitedNodeIds = new Set<string>();

        ancestors.add(node);

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visitedNodeIds.has(current.id)) {
                continue;
            }
            visitedNodeIds.add(current.id);

            // Alle Kanten finden, die zu 'current' führen
            const incomingEdges = graph.edges.filter(e => e.target === current);
            for (const edge of incomingEdges) {
                if (!ancestors.has(edge.source)) {
                    ancestors.add(edge.source);
                    queue.push(edge.source);
                }
            }
        }

        return Array.from(ancestors);
    }

    getNextStateNodeId(currentGraph: ReachabilityGraph): string {
        let nextIdNumber = currentGraph.nodes.length;
        while (currentGraph.nodes.some(n => n.id === `s${nextIdNumber}`)) {
            nextIdNumber++;
        }
        return `s${nextIdNumber}`;
    }

}

interface QueueItem { node: ReachabilityNode; ancestors: ReachabilityNode[]; }
