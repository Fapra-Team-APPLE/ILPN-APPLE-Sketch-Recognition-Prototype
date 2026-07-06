import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {IDiagramNode} from '../../classes/diagram/diagram-types';
import {PLACE_RADIUS, TRANSITION_HALF_WIDTH} from '../../components/display/svg-node/svg-node';
import {closestDistanceFromPointToLine, getEffectiveWaypoints} from '../../components/shared/canvas-helper';
import {distance, ResolvedAction} from '../recognizers/recognition-types';

/**
 * Löst geometrische Mehrdeutigkeiten auf, indem der bestehende Petrinetz-Context analysiert wird
 */
export class AmbiguityResolver {

    resolveNewNodeKind(sourceNode: IDiagramNode): 'place' | 'transition' {
        return sourceNode.kind === 'place' ? 'transition' : 'place';
    }

    /**
     * Prüft, ob eine Edge zwischen zwei bestehenden Nodes gültig ist, und versucht andernfalls, den Konflikt zu lösen
     */
    resolveEdgeConflict(source: IDiagramNode, target: IDiagramNode, diagram: Diagram): ResolvedAction {
        // Erfolgsfall: Bipartite Regel ist erfüllt
        if (source.kind !== target.kind) {
            return {type: 'addEdge', sourceId: source.id, targetId: target.id};
        }

        // Gleicher Node-Typ -> Konflikt. Ein Knoten kann nur reinterpretiert werden, wenn er 0 bestehende Verbindungen hat und keine Stelle mit Marken ist
        if (this.canReinterpret(target, diagram)) {
            return {
                type: 'reinterpretNode',
                nodeId: target.id,
                newKind: target.kind === 'place' ? 'transition' : 'place',
                addEdgeAfter: {sourceId: source.id, targetId: target.id}
            };
        }

        if (this.canReinterpret(source, diagram)) {
            return {
                type: 'reinterpretNode',
                nodeId: source.id,
                newKind: source.kind === 'place' ? 'transition' : 'place',
                addEdgeAfter: {sourceId: source.id, targetId: target.id}
            };
        }

        return {
            type: 'rejected',
            reason: `Cannot connect two ${source.kind}s. Reinterpreting either node would invalidate existing connections.`
        };
    }

    private canReinterpret(node: IDiagramNode, diagram: Diagram): boolean {
        if (node instanceof DiagramNode && node.kind === 'place' && node.tokenCount > 0) {
            return false;
        }
        return this.countConnections(node, diagram) === 0;
    }

    /**
     * Bestimmt, ob eine kleine gezeichnete Form innerhalb einer Stelle eine Marke darstellt
     *
     * @param placeNode Die Stelle, in der die Form gezeichnet wurde
     * @param digitValue Falls eine Ziffer erkannt wurde, der Ziffernwert
     * @param incrementCount Optionale Anzahl der hinzuzufügenden Marken, wenn keine Ziffer erkannt wird
     * @returns Eine ResolvedAction zur Marken-Modifikation
     */
    resolveTokenContext(placeNode: IDiagramNode, digitValue?: number, incrementCount?: number): ResolvedAction {
        // Eine Ziffer "0" innerhalb einer Stelle ist geometrisch eher eine kreisförmige Marken-Geste / ein Tap als eine Zahl
        const normalizedDigit = digitValue === 0 ? undefined : digitValue;

        if (normalizedDigit !== undefined) {
            return {type: 'setTokens', nodeId: placeNode.id, count: normalizedDigit};
        }

        // Punkt oder kleiner Kreis -> Marken inkrementieren
        return {type: 'incrementTokens', nodeId: placeNode.id, count: incrementCount};
    }

    /**
     * Bestimmt, ob eine in der Nähe einer Kante gezeichnete Ziffer ein Kantengewicht darstellt
     *
     * @param digitCenter Mittelpunkt der gezeichneten Ziffer
     * @param digitValue Die erkannte Ziffer
     * @param diagram Aktuelles Diagramm
     * @returns Eine ResolvedAction für die Kantengewicht-Änderung oder null, falls nicht anwendbar
     */
    resolveEdgeWeightContext(digitCenter: {x: number; y: number}, digitValue: number, diagram: Diagram): ResolvedAction | null {
        const bestEdge = this.findEdgeForWeightStroke(digitCenter, diagram);

        if (bestEdge) {
            return {
                type: 'setEdgeWeight',
                sourceId: bestEdge.source.id,
                targetId: bestEdge.target.id,
                weight: digitValue
            };
        }

        return null;
    }

    /**
     * Findet die am nächsten gelegene Edge, für die sich der Punkt innerhalb ihres Kantengewicht-Bereichs befindet
     */
    findEdgeForWeightStroke(point: {x: number; y: number}, diagram: Diagram): DiagramEdge | null {
        let bestEdge: DiagramEdge | null = null;
        let minDistance = Infinity;

        for (const edge of diagram.edges) {
            if (this.isPointWithinSingleEdgeWeightArea(point, edge)) {
                const distToSegment = this.computeDistanceToEdgeSegment(point, edge);
                if (distToSegment < minDistance) {
                    minDistance = distToSegment;
                    bestEdge = edge;
                }
            }
        }

        return bestEdge;
    }

    isPointWithinEdgeWeightArea(point: {x: number; y: number}, diagram: Diagram): boolean {
        return diagram.edges.some(edge => this.isPointWithinSingleEdgeWeightArea(point, edge));
    }

    private isPointWithinSingleEdgeWeightArea(point: {x: number; y: number}, edge: DiagramEdge): boolean {
        const MAX_SEGMENT_DISTANCE = 40; // px
        const maxMidpointDistance = this.computeDynamicRadiusAroundMidpoint(edge);
        const edgeMidpoint = this.computeEdgeMidpoint(edge);
        const distToMidpoint = distance(point, edgeMidpoint);
        const distToSegment = this.computeDistanceToEdgeSegment(point, edge);

        return distToMidpoint < maxMidpointDistance && distToSegment < MAX_SEGMENT_DISTANCE;
    }

    private computeDynamicRadiusAroundMidpoint(edge: DiagramEdge): number {
        if (edge.source.id === edge.target.id) {
            return 50;
        }

        const midpoint = this.computeEdgeMidpoint(edge);

        const distToSource = distance({x: edge.source.x(), y: edge.source.y()}, midpoint);
        const distToTarget = distance(midpoint, {x: edge.target.x(), y: edge.target.y()});
        const totalDist = distToSource + distToTarget;

        // Node-Radien abziehen, um die geschätzte freie Segmentlänge zu erhalten
        const visibleLength = Math.max(10, totalDist - TRANSITION_HALF_WIDTH - (PLACE_RADIUS / 2));

        // Radius auf 30 % der sichtbaren Länge skalieren (aber Minimum von 30px)
        return Math.max(30, visibleLength * 0.3);
    }

    private computeDistanceToEdgeSegment(point: {x: number; y: number}, edge: DiagramEdge): number {
        const waypoints = getEffectiveWaypoints(edge);
        const polylinePoints = [
            {x: edge.source.x(), y: edge.source.y()},
            ...waypoints,
            {x: edge.target.x(), y: edge.target.y()}
        ];

        let minDistance = Infinity;
        for (let i = 0; i < polylinePoints.length - 1; i++) {
            const dist = closestDistanceFromPointToLine(point, polylinePoints[i], polylinePoints[i + 1]);
            if (dist < minDistance) {
                minDistance = dist;
            }
        }
        return minDistance;
    }


    private countConnections(node: IDiagramNode, diagram: Diagram): number {
        return diagram.edges.filter(e => e.source.id === node.id || e.target.id === node.id).length;
    }

    public computeEdgeMidpoint(edge: DiagramEdge): {x: number; y: number} {
        const waypoints = getEffectiveWaypoints(edge);
        if (waypoints.length > 0) {
            const mid = waypoints[Math.floor(waypoints.length / 2)];
            return {x: mid.x, y: mid.y};
        }

        return {
            x: (edge.source.x() + edge.target.x()) / 2,
            y: (edge.source.y() + edge.target.y()) / 2
        };
    }

}
