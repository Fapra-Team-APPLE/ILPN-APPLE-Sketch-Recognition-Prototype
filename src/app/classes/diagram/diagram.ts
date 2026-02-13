import {LayoutFrame} from '../layout/layout-frame';
import {DiagramEdge} from './diagram-edge';
import {updateEdgeCurves} from './diagram-layout-helper';
import {DiagramNode} from './diagram-node';
import {DiagramHint, IDiagramNode} from './diagram-types';

export class Diagram<NodeType extends IDiagramNode = IDiagramNode, EdgeType extends DiagramEdge<NodeType> = DiagramEdge<NodeType>> {

    private readonly _nodes: Array<NodeType>;
    private readonly _edges: Array<EdgeType>;
    /**
     * Optional gespeicherte Zwischenzustände eines Layout-Laufs. Diese werden
     * vom LayoutService gefüllt und später in der DisplayComponent animiert.
     */
    layoutFrames?: LayoutFrame[];
    hint?: DiagramHint;

    constructor(elements: Array<NodeType>, edges: Array<EdgeType> = []) {
        this._nodes = elements;
        this._edges = edges;
        updateEdgeCurves(this._edges);
    }

    get nodes(): Array<NodeType> {
        return this._nodes;
    }

    get edges(): Array<EdgeType> {
        return this._edges;
    }

    clone(): Diagram<NodeType, EdgeType> {
        const newNodes = this._nodes.map(n => n.clone());
        const newEdges = this._edges.map(e => {
            const source = newNodes.find(n => n.id === e.source.id);
            const target = newNodes.find(n => n.id === e.target.id);
            if (!source || !target) {
                throw new Error('Source or target node not found in cloned nodes');
            }
            const newEdge = e.clone();
            // @ts-ignore
            newEdge._source = source;
            // @ts-ignore
            newEdge._target = target;
            return newEdge;
        });
        const clone = new Diagram(newNodes, newEdges);
        clone.hint = this.hint;
        return clone;
    }

    getRelated(node: NodeType, direction: 'in' | 'out'): NodeType[] {
        return direction === 'in'
            ? this._edges.filter(e => e.target.id === node.id).map(e => e.source)
            : this._edges.filter(e => e.source.id === node.id).map(e => e.target);
    }

    hasNodeByEffectiveLabel(effectiveLabel: string, kind: string): boolean {
        return this._nodes.some(n =>
            n.kind === kind && n.effectiveLabel() === effectiveLabel);
    }

    findNodeByEffectiveLabel(effectiveLabel: string, kind: string) {
        return this._nodes.find(n =>
            n.kind === kind && n.effectiveLabel() === effectiveLabel);
    }

    findNodesByEffectiveLabel(effectiveLabel: string, kind: string): NodeType[] {
        return this._nodes.filter(n =>
            n.kind === kind && (n.effectiveLabel() === effectiveLabel));
    }

    hasEdgeByEffectiveLabel(sourceEffectiveLabel: string, targetEffectiveLabel: string): boolean {
        return this._edges.some(e => {
            return (e.source.effectiveLabel() === sourceEffectiveLabel) && (e.target.effectiveLabel() === targetEffectiveLabel);
        });
    }

    findEdgeByEffectiveLabel(sourceEffectiveLabel: string, targetEffectiveLabel: string) {
        return this._edges.find(e => {
            return (e.source.effectiveLabel() === sourceEffectiveLabel) && (e.target.effectiveLabel() === targetEffectiveLabel);
        });
    }

    findEdgeById(sourceId: string, targetId: string) {
        return this._edges.find(e => {
            return (e.source.id === sourceId) && (e.target.id === targetId);
        });
    }

    outgoingEdges(node: NodeType): EdgeType[] {
        return this._edges.filter(e => e.source.id === node.id);
    }

    incomingEdges(node: NodeType): EdgeType[] {
        return this._edges.filter(e => e.target.id === node.id);
    }

    // FROM: services/parsing/petri-net-definition-parser.service.ts
    // Einfaches Layout: Plätze auf großem Kreis, Transitionen auf innerem Kreis
    // (wird aktuell nicht von LayoutService verwendet, bleibt aber als
    // Referenz und Fallback bestehen).
    applyTwoRingsLayout() {
        const places = this._nodes.filter(n => n.kind === 'place');
        const trans = this._nodes.filter(n => n.kind === 'transition');

        this.applyCircularLayout(places, 300, 220, 170, 0);
        this.applyCircularLayout(trans, 300, 220, 110, Math.PI / 12);
    }

    private applyCircularLayout(nodes: NodeType[], centerX = 300, centerY = 220, radius = 150, offsetAngle = 0) {
        const nodeCount = nodes.length;
        if (nodeCount === 0) {
            return;
        }
        for (let i = 0; i < nodeCount; i++) {
            const angle = offsetAngle + (2 * Math.PI * i) / nodeCount;
            nodes[i].setX(Math.round(centerX + radius * Math.cos(angle)));
            nodes[i].setY(Math.round(centerY + radius * Math.sin(angle)));
        }
    }

    applySimpleLayout(): void {
        const HORIZONTAL_SPACING = 100;
        const VERTICAL_SPACING = 75;
        const START_X = 75;
        const START_Y = 75;

        // Berechne Ebenen (Level) für jeden Knoten
        const levels = this.calculateNodeLevels();
        const nodesByLevel = new Map<number, NodeType[]>();

        // Gruppiere Knoten nach Ebenen
        for (const [node, level] of levels) {
            if (!nodesByLevel.has(level)) {
                nodesByLevel.set(level, []);
            }
            nodesByLevel.get(level)!.push(node);
        }

        // Positioniere Knoten ebenenweise (horizontal)
        for (const [level, nodes] of nodesByLevel) {
            const x = START_X + level * HORIZONTAL_SPACING;

            nodes.forEach((node, index) => {
                const y = START_Y + index * VERTICAL_SPACING;
                node.setX(x);
                node.setY(y);
            });
        }
    }

    /**
     * Berechnet die Ebene (Level) jedes Knotens im Diagramm
     * Anfangsstellen (ohne eingehende Kanten) haben Level 0, alle anderen Knoten haben höhere Level
     * Wichtig: Nachfolgende Knoten einer Transition haben immer Level = Transition-Level + 1
     */
    private calculateNodeLevels(): Map<NodeType, number> {
        const levels = new Map<NodeType, number>();
        const visited = new Set<string>();

        // Finde Knoten ohne eingehende Kanten
        const startNodes = this._nodes.filter(n =>
            n.kind === 'place' &&
            !this._edges.some(e => e.target.id === n.id));

        // Setze Level 0 für Anfangsknoten
        for (const node of startNodes) {
            levels.set(node, 0);
            visited.add(node.id);
        }

        // Iteriere, bis alle Knoten ein Level haben
        let done = true;
        while (done) {
            done = false;

            for (const node of this._nodes) {
                if (visited.has(node.id)) {
                    continue;
                }

                const predecessors = this.getRelated(node, 'in');

                // Prüfe, ob alle Vorgänger bereits ein Level haben
                const allPreVisited = predecessors.every(pred => levels.has(pred));
                if (!allPreVisited) {
                    continue;
                }

                // Berechne das Level als Maximum aller Vorgänger-Level + 1
                const maxLevel = predecessors.length > 0
                    ? Math.max(...predecessors.map(pred => levels.get(pred)!))
                    : -1;

                levels.set(node, maxLevel + 1);
                visited.add(node.id);
                done = true;
            }
        }

        return levels;
    }

    getMarking(): Record<string, number> {
        const placeNodes: NodeType[] = this.nodes.filter(n => n.kind === 'place');
        const marking: Record<string, number> = {};
        for (const node of placeNodes) {
            if (node instanceof DiagramNode) {
                marking[node.id] = node.tokenCount;
            }
        }
        return marking;
    }

    setToMarking(marking: Record<string, number>): void {
        for (const key in marking) {
            if (this.hasNodeByEffectiveLabel(key, 'place')) {
                const node = this.findNodeByEffectiveLabel(key, 'place');
                if (node instanceof DiagramNode) {
                    node.tokenCount = marking[key];
                }
            }
        }
    }

    getNonCoordinateHash(): string {
        const nodes = this.nodes.map(n => {
            const validity = n.validity();
            const validityString = '';
            if (validity) {
                let reasons = '';
                if (validity.status !== 'valid') {
                    reasons = validity.reasons.sort().join(',');
                }
                validityString.concat(`overall:${validity.status}${reasons ? `(${reasons})` : ''}`);
            }

            return `${n.id}|${n.label()}|${n.kind}|${validityString}|${n.kind === 'place' && n instanceof DiagramNode ? n.tokenCount : ''}`;
        }).sort().join(';');

        const edges = this.edges.map(edge => {
            return `${edge.source.id}|${edge.target.id}|${edge.weight()}|${edge.label()}`;
        }).sort().join(';');

        return `N:${nodes};E:${edges}`;
    }

}
