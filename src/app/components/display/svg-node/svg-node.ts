import {DiagramNodeKind} from '../../../classes/diagram/diagram-types';
import {Coords} from '../../../classes/json-petri-net';
import {STATE_NODE_HEIGHT} from './state-node/state-node.component';

export const PLACE_RADIUS = 22;
export const TRANSITION_WIDTH = 44;
export const TRANSITION_HEIGHT = 44;
export const EDIT_BOX_WIDTH = 120;
export const EDIT_BOX_HEIGHT = 22;

export const TRANSITION_HALF_WIDTH = TRANSITION_WIDTH / 2;
export const TRANSITION_HALF_HEIGHT = TRANSITION_HEIGHT / 2;

export const LABEL_GAP = 12;
export const STROKE_PAD = 4;
export const CANVAS_PADDING = 12;

export interface NodeMargins {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export function calculateNodeMargins(kind: DiagramNodeKind, dimension?: { w: number, h: number }): NodeMargins {
    const marginForLabel = LABEL_GAP + 6;
    if (kind === 'place') {
        const radiusPlusStrokePad = PLACE_RADIUS + STROKE_PAD;
        const bottom = radiusPlusStrokePad + marginForLabel;
        return {left: radiusPlusStrokePad, right: radiusPlusStrokePad, top: radiusPlusStrokePad, bottom};
    } else if (kind === 'transition') {
        const halfWidth = TRANSITION_WIDTH / 2;
        const halfHeight = TRANSITION_HEIGHT / 2;
        const halfWidthPlusStrokePad = halfWidth + STROKE_PAD;
        const halfHeightPlusStrokePad = halfHeight + STROKE_PAD;
        const bottom = halfHeightPlusStrokePad + marginForLabel;
        return {left: halfWidthPlusStrokePad, right: halfWidthPlusStrokePad, top: halfHeightPlusStrokePad, bottom};
    } else {
        const halfHeight = (dimension?.h ?? STATE_NODE_HEIGHT) / 2;
        const halfHeightPlusStrokePad = halfHeight + STROKE_PAD;

        const minHalfWidth = (dimension?.w ?? 50) / 2;
        const halfWidthPlusStrokePad = minHalfWidth + STROKE_PAD;

        const bottom = halfHeightPlusStrokePad + marginForLabel;
        return {left: halfWidthPlusStrokePad, right: halfWidthPlusStrokePad, top: halfHeightPlusStrokePad, bottom};
    }
}

/**
 * Berechnet den Endpunkt einer Kante am Rand des Zielknotens.
 * @param source Startpunkt der Kante
 * @param target Zielpunkt der Kante (Knotenmitte)
 * @param targetKind Art des Zielknotens ('place', 'transition' oder 'state')
 * @param dynamicWidth Optionale Breite für State-Nodes
 * @param dynamicHeight Optionale Höhe für State-Nodes
 */
export function calculateEdgeEndpoint(
    source: Coords,
    target: Coords,
    targetKind: DiagramNodeKind,
    dynamicWidth?: number,
    dynamicHeight?: number
): Coords {
    const deltaX = target.x - source.x;
    const deltaY = target.y - source.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length === 0) {
        // Quelle == Ziel; nichts zu berechnen
        return {x: target.x, y: target.y};
    }
    const normalizedX = deltaX / length;
    const normalizedY = deltaY / length;

    if (targetKind === 'place') {
        // Kreis: vom Zentrum entlang der Gegenrichtung um Radius zurückrücken
        return {
            x: target.x - normalizedX * PLACE_RADIUS,
            y: target.y - normalizedY * PLACE_RADIUS
        };
    }

    // Rechteck: Skaliere den Richtungsvektor so, dass er die Rechteckkante trifft
    // t = 1 / max(|deltaX|/halfW, |deltaY|/halfH)
    let halfW: number;
    let halfH: number;

    if (targetKind === 'transition') {
        halfW = TRANSITION_HALF_WIDTH;
        halfH = TRANSITION_HALF_HEIGHT;
    } else {
        halfW = (dynamicWidth ?? 60) / 2;
        halfH = (dynamicHeight ?? 30) / 2;
    }

    const denominator = Math.max(
        Math.abs(deltaX) / halfW,
        Math.abs(deltaY) / halfH
    ) || 1;

    const t = 1 / denominator; // Strecke vom Zentrum bis zur Kante entlang (deltaX,deltaY)
    return {
        x: target.x - deltaX * t,
        y: target.y - deltaY * t
    };
}
