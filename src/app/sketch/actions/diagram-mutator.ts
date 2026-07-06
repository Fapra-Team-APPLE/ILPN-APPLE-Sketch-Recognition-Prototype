import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {ResolvedAction} from '../recognizers/recognition-types';

/**
 * Übersetzt ResolvedActions in konkrete Diagramm-Mutationen
 */
export class DiagramMutator {

    /**
     * Wendet eine ResolvedAction auf das übergebene Diagramm an
     * @returns Das neue Diagramm oder null, falls keine Änderung vorgenommen wurde
     */
    apply(action: ResolvedAction, diagram: Diagram): Diagram | null {
        switch (action.type) {
                case 'addPlace':
                    return this.addNode('place', action.center.x, action.center.y, diagram);

                case 'addTransition':
                    return this.addNode('transition', action.center.x, action.center.y, diagram);

                case 'addEdge':
                    return this.addEdge(action.sourceId, action.targetId, diagram);

                case 'addEdgeWithNewNode':
                    return this.addEdgeWithNewNode(
                        action.sourceId,
                        action.targetPos.x,
                        action.targetPos.y,
                        action.newNodeKind,
                        diagram
                    );

                case 'delete':
                    return this.deleteElements(action.targetIds, action.edgeKeys, diagram);

                case 'setTokens':
                    return this.setTokens(action.nodeId, action.count, diagram);

                case 'incrementTokens':
                    return this.incrementTokens(action.nodeId, diagram, action.count);

                case 'setEdgeWeight':
                    return this.setEdgeWeight(action.sourceId, action.targetId, action.weight, diagram);

                case 'reinterpretNode':
                    return this.reinterpretNode(action.nodeId, action.newKind, diagram, action.addEdgeAfter);

                case 'rejected':
                case 'none':
                    return null;

                default:
                    return null;
        }
    }


    private addNode(kind: 'place' | 'transition', x: number, y: number, diagram: Diagram): Diagram {
        const id = this.generateNodeId(kind, diagram);
        const newNode = new DiagramNode(id, kind, x, y);
        return new Diagram([...diagram.nodes, newNode], [...diagram.edges]);
    }

    private reinterpretNode(nodeId: string, newKind: 'place' | 'transition', diagram: Diagram, addEdgeAfter?: { sourceId: string; targetId: string }): Diagram {
        // Neue ID generieren, wie bei einem frisch erstellten Knoten dieses Typs
        const newId = this.generateNodeId(newKind, diagram);

        const updatedNodes = diagram.nodes.map(n => {
            if (n.id !== nodeId) {
                return n;
            }
            // Neuen Knoten an derselben Position aber mit neuer ID und anderer Art erstellen
            const newNode = new DiagramNode(newId, newKind, n.x(), n.y());
            if (n instanceof DiagramNode) {
                newNode.setLabel(n.label());
            }
            return newNode;
        });

        // Kanten, die auf die aktualisierten Knoten verweisen, neu erstellen
        const nodeMap = new Map(updatedNodes.map(n => [n.id, n]));
        const updatedEdges = diagram.edges.map(e => {
            const source = nodeMap.get(e.source.id) ?? e.source;
            const target = nodeMap.get(e.target.id) ?? e.target;
            return new DiagramEdge(source, target, e.weight(), [...e.waypoints()], e.label(), e.curveIndex());
        });

        const intermediateDiagram = new Diagram(updatedNodes, updatedEdges);
        if (addEdgeAfter) {
            // Alte Node-ID für addEdge durch die neue ID ersetzen
            const resolvedSourceId = addEdgeAfter.sourceId === nodeId ? newId : addEdgeAfter.sourceId;
            const resolvedTargetId = addEdgeAfter.targetId === nodeId ? newId : addEdgeAfter.targetId;
            const finalDiagram = this.addEdge(resolvedSourceId, resolvedTargetId, intermediateDiagram);
            return finalDiagram || intermediateDiagram;
        }

        return intermediateDiagram;
    }


    private addEdge(sourceId: string, targetId: string, diagram: Diagram): Diagram | null {
        const source = diagram.nodes.find(n => n.id === sourceId);
        const target = diagram.nodes.find(n => n.id === targetId);
        if (!source || !target) {
            return null;
        }

        const existingEdge = diagram.edges.find(
            e => e.source.id === sourceId && e.target.id === targetId
        );
        if (existingEdge) {
            existingEdge.incrementWeight();
            return diagram;
        }

        const edge = new DiagramEdge(source, target);
        return new Diagram([...diagram.nodes], [...diagram.edges, edge]);
    }

    private addEdgeWithNewNode(sourceId: string, targetX: number, targetY: number, newNodeKind: 'place' | 'transition', diagram: Diagram): Diagram | null {
        const source = diagram.nodes.find(n => n.id === sourceId);
        if (!source) {
            return null;
        }

        const newId = this.generateNodeId(newNodeKind, diagram);
        const newNode = new DiagramNode(newId, newNodeKind, targetX, targetY);
        const edge = new DiagramEdge(source, newNode);

        return new Diagram(
            [...diagram.nodes, newNode],
            [...diagram.edges, edge]
        );
    }


    private deleteElements(nodeIds: string[], edgeKeys: string[], diagram: Diagram): Diagram {
        const nodeIdSet = new Set(nodeIds);
        const edgeKeySet = new Set(edgeKeys);

        const remainingNodes = diagram.nodes.filter(n => !nodeIdSet.has(n.id));
        const remainingEdges = diagram.edges.filter(e => {
            // Edges entfernen, die mit gelöschten Nodes verbunden sind
            if (nodeIdSet.has(e.source.id) || nodeIdSet.has(e.target.id)) {
                return false;
            }
            // Explizit gelöschte Edges entfernen
            const key = `${e.source.id}|${e.target.id}`;
            return !edgeKeySet.has(key);
        });

        return new Diagram(remainingNodes, remainingEdges);
    }


    private setTokens(nodeId: string, count: number, diagram: Diagram): Diagram | null {
        const node = diagram.nodes.find(n => n.id === nodeId);
        if (!node || !(node instanceof DiagramNode) || node.kind !== 'place') {
            return null;
        }
        node.tokenCount = count;
        return diagram;
    }

    private incrementTokens(nodeId: string, diagram: Diagram, count: number = 1): Diagram | null {
        const node = diagram.nodes.find(n => n.id === nodeId);
        if (!node || !(node instanceof DiagramNode) || node.kind !== 'place') {
            return null;
        }
        for (let i = 0; i < count; i++) {
            node.incrementTokenCount();
        }
        return diagram;
    }

    private setEdgeWeight(sourceId: string, targetId: string, weight: number, diagram: Diagram): Diagram | null {
        const edge = diagram.edges.find(
            e => e.source.id === sourceId && e.target.id === targetId
        );
        if (!edge) {
            return null;
        }

        while (edge.weight() < weight) {
            edge.incrementWeight();
        }
        while (edge.weight() > weight && edge.weight() > 1) {
            edge.decrementWeight();
        }
        return diagram;
    }


    private generateNodeId(kind: 'place' | 'transition', diagram: Diagram): string {
        const prefix = kind === 'place' ? 'p' : 't';
        const existingIds = new Set(diagram.nodes.map(n => n.id));
        const existingLabels = new Set(diagram.nodes.map(n => n.effectiveLabel()));
        let counter = 1;
        let candidate = `${prefix}${counter}`;
        while (existingIds.has(candidate) || existingLabels.has(candidate)) {
            counter++;
            candidate = `${prefix}${counter}`;
        }
        return candidate;
    }

}
