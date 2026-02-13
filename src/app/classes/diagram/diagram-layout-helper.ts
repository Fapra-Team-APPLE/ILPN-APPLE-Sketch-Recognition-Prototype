import {DiagramEdge} from './diagram-edge';

export const getEdgeKey = (s: string, t: string) => `${s}->${t}`;

export function calculateCurveIndex(sourceId: string, targetId: string, hasReverseEdges: boolean): number {
    if (sourceId === targetId) { // Kante ist eine Schleife
        return 0;
    }

    if (hasReverseEdges) {
        return 1.5; // Shift nach rechts, um Platz für Gegenrichtung zu schaffen
    }

    return 0;
}

export function groupEdgesByDirection(edges: DiagramEdge[]) {
    const edgesByDir = new Map<string, DiagramEdge[]>();

    for (const edge of edges) {
        const key = getEdgeKey(edge.source.id, edge.target.id);
        if (!edgesByDir.has(key)) {
            edgesByDir.set(key, []);
        }
        edgesByDir.get(key)!.push(edge);
    }
    return edgesByDir;
}

export function updateEdgeCurves(edges: DiagramEdge[]) {
    const edgesByDir = groupEdgesByDirection(edges);

    for (const edge of edges) {
        const source = edge.source.id;
        const target = edge.target.id;
        const reverseKey = getEdgeKey(target, source);

        const reverseEdges = edgesByDir.get(reverseKey) || [];
        const hasReverseEdges = reverseEdges.length > 0;

        const curveIndex = calculateCurveIndex(source, target, hasReverseEdges);
        edge.setCurveIndex(curveIndex);
    }
}
