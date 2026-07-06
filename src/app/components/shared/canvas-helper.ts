import {IDiagramEdge, IDiagramNode} from '../../classes/diagram/diagram-types';
import {Coords} from '../../classes/json-petri-net';
import {calculateEdgeEndpoint, PLACE_RADIUS, TRANSITION_HEIGHT, TRANSITION_WIDTH} from '../display/svg-node/svg-node';

export const convertGlobalToSvgCoordinates = (svg: SVGSVGElement, clientX: number, clientY: number): Coords | null => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
        return null;
    }
    // siehe https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/samples/hh535760(v=vs.85)
    const p = pt.matrixTransform(ctm.inverse());
    return {x: p.x, y: p.y};
};

export const hitTestSvgPoint = (node: IDiagramNode, p: Coords, stateDimension?: {w: number; h: number}, includeLabel = false) => {
    if (node.kind === 'place') {
        const dx = p.x - node.x();
        const dy = p.y - node.y();
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= PLACE_RADIUS) {
            return true;
        }
        if (!includeLabel) {
            return false;
        }
        return hitTestPlaceLabel(node, dx, dy);
    }

    let halfW: number;
    let halfH: number;

    if (node.kind === 'state') {
        const dim = stateDimension ?? {w: 60, h: 28};
        halfW = dim.w / 2;
        halfH = dim.h / 2;
    } else {
        halfW = TRANSITION_WIDTH / 2;
        halfH = TRANSITION_HEIGHT / 2;
    }

    return Math.abs(p.x - node.x()) <= halfW && Math.abs(p.y - node.y()) <= halfH;
};

// eslint-disable-next-line max-params
export const hitTest = (svg: SVGSVGElement, node: IDiagramNode, clientX: number, clientY: number, stateDimension?: {w: number, h: number}, includeLabel = false) => {
    const p = convertGlobalToSvgCoordinates(svg, clientX, clientY);
    if (!p) {
        return false;
    }
    return hitTestSvgPoint(node, p, stateDimension, includeLabel);
};

export function isSvgPointNearSegment(edge: IDiagramEdge, pointer: Coords, hitTolerancePx = 8) {
    const waypoints = getEffectiveWaypoints(edge);
    let polylinePoints: Coords[];

    // Spezialfall Schleife ohne Wegpunkte: Bezier-Kurve auswerten
    if (edge.source === edge.target && edge.waypoints().length === 0 && waypoints.length === 2) {
        const start = {x: edge.source.x(), y: edge.source.y()};
        const controlPoint1 = waypoints[0];
        const controlPoint2 = waypoints[1];
        const end = {x: edge.target.x(), y: edge.target.y()};

        polylinePoints = [];
        const steps = 16;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const pointOnCurve = bezierPoint(t, [start, controlPoint1, controlPoint2, end]);
            polylinePoints.push(pointOnCurve);
        }
    } else {
        polylinePoints = [
            {x: edge.source.x(), y: edge.source.y()},
            ...waypoints,
            {x: edge.target.x(), y: edge.target.y()}
        ];
    }

    // Prüfe alle aufeinanderfolgenden Punkte als Segment
    for (let index = 0; index < polylinePoints.length - 1; index++) {
        const segmentStart = polylinePoints[index];
        const segmentEnd = polylinePoints[index + 1];

        const distanceToSegment = closestDistanceFromPointToLine(pointer, segmentStart, segmentEnd);
        if (distanceToSegment <= Math.max(1, hitTolerancePx)) {
            return true;
        }
    }

    return false;
}

export const isPointNearSegment = (svg: SVGSVGElement, edge: IDiagramEdge, clientX: number, clientY: number): boolean => {
    const pointer = convertGlobalToSvgCoordinates(svg, clientX, clientY);
    if (!pointer) {
        return false;
    }

    return isSvgPointNearSegment(edge, pointer);
};

export const calculateLoopControlPoints = (x: number, y: number): Coords[] => {
    const loopHeight = 90;
    const loopWidth = 72;

    return [
        {x: x - loopWidth, y: y - loopHeight},
        {x: x + loopWidth, y: y - loopHeight}
    ];
};

export const getLoopPathData = (source: IDiagramNode, dynamicWidth?: number, dynamicHeight?: number): string => {
    const sourceX = source.x();
    const sourceY = source.y();
    const [controlPoint1, controlPoint2] = calculateLoopControlPoints(sourceX, sourceY);
    const startPoint = calculateEdgeEndpoint(controlPoint1, {x: sourceX, y: sourceY}, source.kind, dynamicWidth, dynamicHeight);
    const endPoint = calculateEdgeEndpoint(controlPoint2, {x: sourceX, y: sourceY}, source.kind, dynamicWidth, dynamicHeight);
    return `M ${startPoint.x},${startPoint.y} C ${controlPoint1.x},${controlPoint1.y} ${controlPoint2.x},${controlPoint2.y} ${endPoint.x},${endPoint.y}`;
};

export const getEffectiveWaypoints = (edge: IDiagramEdge): Coords[] => {
    if (edge.waypoints().length > 0) { // Benutzerdefinierte Wegpunkte haben Vorrang
        return edge.waypoints();
    }

    const curveIndex = edge.curveIndex();
    const sourceX = edge.source.x();
    const sourceY = edge.source.y();

    if (edge.source === edge.target) { // Sonderfall Schleife
        return calculateLoopControlPoints(sourceX, sourceY);
    }

    if (curveIndex !== 0) {
        const targetX = edge.target.x();
        const targetY = edge.target.y();

        const midX = (sourceX + targetX) / 2;
        const midY = (sourceY + targetY) / 2;

        const dx = targetX - sourceX;
        const dy = targetY - sourceY;
        const len = Math.sqrt(dx * dx + dy * dy);

        if (len > 0) {
            // Senkrechter Vektor (-dy, dx)
            const nx = -dy / len;
            const ny = dx / len;

            const offset = curveIndex * 20; // 20px pro Kurvenindex

            return [{
                x: midX + nx * offset,
                y: midY + ny * offset
            }];
        }
    }
    return [];
};

/**
 * Berechnet einen Punkt auf einer Bezier-Kurve mit 4 Kontrollpunkten
 * @param t Parameter zwischen 0 und 1
 * @param points Array mit 4 Kontrollpunkten
 * @returns Koordinaten des Punkts auf der Kurve
 */
export const bezierPoint = (t: number, points: Coords[]): Coords => {
    if (points.length !== 4) {
        throw new Error('Bezier point calculation only valid for 4 control points');
    }
    const p0 = points[0];
    const p1 = points[1];
    const p2 = points[2];
    const p3 = points[3];

    const mt = 1 - t;

    // https://stackoverflow.com/a/54216695
    const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
    const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;

    return {x, y};
};

export const bringToFront = (element: SVGGElement | null) => {
    // Das setTimeout ist in diesem Fall nicht, wie sonst üblich, für das Warten auf den nächsten Render-Zyklus, sondern um einen Bug im Firefox zu umgehen, bei das
    // DOM-Manipulieren innerhalb eines Pointer-Event-Handlers zum bubblen des Events führt
    setTimeout(() => {
        const parent = element?.parentElement;
        if (element && parent && parent.lastElementChild !== element) {
            parent.appendChild(element);
        }
    });
};

// https://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment
export const closestDistanceFromPointToLine = (point: Coords, start: Coords, end: Coords): number => {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lineLengthSquared = deltaX * deltaX + deltaY * deltaY;

    // (Start == Ende): einfacher Punktabstand
    if (lineLengthSquared === 0) {
        return Math.hypot(point.x - start.x, point.y - start.y);
    }

    // Projektionsfaktor entlang der Linie zwischen [0..1]
    const projectionFactorUnclamped =
        ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lineLengthSquared;
    const projectionFactor = Math.max(0, Math.min(1, projectionFactorUnclamped));

    // Nächstgelegener Punkt auf der Linie
    const closestX = start.x + projectionFactor * deltaX;
    const closestY = start.y + projectionFactor * deltaY;

    // Euklidischer Abstand zum nächstgelegenen Punkt
    return Math.hypot(point.x - closestX, point.y - closestY);
};

const hitTestPlaceLabel = (node: IDiagramNode, dx: number, dy: number) => {
    const labelWidth = getTextWidth(node.effectiveLabel());
    const halfLabelW = labelWidth / 2;
    const padding = 10;

    const labelTop = PLACE_RADIUS + 3;
    const labelBottom = PLACE_RADIUS + 23;
    return Math.abs(dx) <= (halfLabelW + padding) && dy >= labelTop && dy <= labelBottom;
};


let textMeasurementCanvas: HTMLCanvasElement | null = null;

export const getTextWidth = (text: string, font = '12px "Courier New", sans-serif'): number => {
    if (typeof document === 'undefined') {
        return text.length * 7.2;
    }
    textMeasurementCanvas ??= document.createElement('canvas');
    const context = textMeasurementCanvas.getContext('2d');
    if (context) {
        context.font = font;
        return context.measureText(text).width;
    }
    return text.length * 7.2;
};
