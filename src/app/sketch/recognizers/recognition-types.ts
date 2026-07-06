export interface Point {
    x: number;
    y: number;
}

export interface StrokePoint extends Point {
    /** Timestamp in Millisekunden (von performance.now() oder Date.now()) */
    timestamp: number;
    /** Druck (Pressure) des Pointers, falls verfügbar (0..1) */
    pressure?: number;
}

/** Bounding Box mit berechnetem Center */
export interface BoundingBox {
    x: number;
    y: number;
    w: number;
    h: number;
    cx: number;
    cy: number;
}

export type ShapeType = 'circle' | 'rectangle' | 'line' | 'scribble' | 'dot' | 'unknown';

export interface RecognitionCandidate {
    shape: ShapeType;
    /** Confidence-Score zwischen 0 und 1 */
    confidence: number;
    boundingBox: BoundingBox;
    center: {x: number; y: number};
}

export interface RecognitionResult {
    best: RecognitionCandidate;
    alternatives: RecognitionCandidate[];
    rawPoints: StrokePoint[];
}

/**
 * Aktionen (Mutationen des Diagramms)
 */
export type ResolvedAction =
    | {type: 'addPlace'; center: {x: number; y: number}}
    | {type: 'addTransition'; center: {x: number; y: number}}
    | {type: 'addEdge'; sourceId: string; targetId: string}
    | {type: 'addEdgeWithNewNode'; sourceId: string; targetPos: {x: number; y: number}; newNodeKind: 'place' | 'transition'}
    | {type: 'delete'; targetIds: string[]; edgeKeys: string[]}
    | {type: 'setTokens'; nodeId: string; count: number}
    | {type: 'incrementTokens'; nodeId: string; count?: number}
    | {type: 'setEdgeWeight'; sourceId: string; targetId: string; weight: number}
    | {type: 'reinterpretNode'; nodeId: string; newKind: 'place' | 'transition'; addEdgeAfter?: {sourceId: string; targetId: string}}
    | {type: 'rejected'; reason: string}
    | {type: 'none'};


export function computeBoundingBox(points: Point[]): BoundingBox {
    if (points.length === 0) {
        return {x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0};
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    return {x: minX, y: minY, w, h, cx: minX + w / 2, cy: minY + h / 2};
}

/** Euklidische Distanz zwischen zwei Punkten */
export function distance(a: {x: number; y: number}, b: {x: number; y: number}): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pathLength(points: Point[]): number {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
        len += distance(points[i - 1], points[i]);
    }
    return len;
}
