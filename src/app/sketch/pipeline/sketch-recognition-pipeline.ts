import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {IDiagramNode} from '../../classes/diagram/diagram-types';
import {PLACE_RADIUS} from '../../components/display/svg-node/svg-node';
import {hitTestSvgPoint, isSvgPointNearSegment} from '../../components/shared/canvas-helper';
import {IDigitRecognizer} from '../recognizers/digit-recognizer.interface';
import {computeBoundingBox, distance, pathLength, ResolvedAction, StrokePoint} from '../recognizers/recognition-types';
import {IStrokeRecognizer} from '../recognizers/stroke-recognizer.interface';
import {AmbiguityResolver} from './ambiguity-resolver';

export interface PipelineConfig {
    recognizer: IStrokeRecognizer;
    digitRecognizer: IDigitRecognizer;
    getDiagram: () => Diagram | null;
    getSvg: () => SVGSVGElement | null;
}

export class SketchRecognitionPipeline {

    private static readonly MIN_CONFIDENCE = 0.5;
    // Minimale Pfadlänge für Rechtecke und Kreise (px), um unbeabsichtigte Knotenerzeugung zu vermeiden
    private static readonly MIN_STROKE_PATH_LENGTH_FOR_SHAPES = 70;

    public readonly ambiguityResolver = new AmbiguityResolver();

    constructor(public readonly config: PipelineConfig) {
    }

    /**
     * Verarbeitet einen abgeschlossenen Stroke und gibt die auszuführende Aktion zurück
     */
    processStroke(points: StrokePoint[]): ResolvedAction {
        if (points.length < 2) {
            return {type: 'none'};
        }

        const diagram = this.config.getDiagram();
        if (!diagram) {
            // Noch kein Diagramm vorhanden: Nur Grundformen
            return this.processShapeOnEmptyCanvas(points);
        }

        const bbox = computeBoundingBox(points);
        const center = {x: bbox.cx, y: bbox.cy};

        // 0. Zuerst Scribble prüfen (damit das Scribble-Verhalten nicht beeinträchtigt wird)
        const recognitionResult = this.config.recognizer.recognize(points);
        const bestCandidate = recognitionResult.best;
        if (bestCandidate.shape === 'scribble' && bestCandidate.confidence >= 0.8) {
            const containingPlace = this.findPlaceContainingStroke(points, diagram);
            if (containingPlace) {
                return {type: 'setTokens', nodeId: containingPlace.id, count: 0};
            }
            return this.processScribble(points, diagram);
        }

        // 1. Prüfen, ob sich der Stroke vollständig in einer Stelle befindet
        const containingPlace = this.findPlaceContainingStroke(points, diagram);
        if (containingPlace) {
            // Diesen Stroke zwingend NUR als Marken-Modifikation interpretieren
            const digitResult = this.config.digitRecognizer.recognize(points);
            return this.ambiguityResolver.resolveTokenContext(containingPlace, digitResult?.digit);
        }

        // 2. Andernfalls: Prüfen, ob Stroke in einer Stelle ist (Marken-Context, nur kleine Strokes)
        const tokenAction = this.checkTokenContext(points, center, diagram);
        if (tokenAction) {
            return tokenAction;
        }

        // 3. Prüfen, ob Stroke eine Ziffer nahe einer Kante ist
        const weightAction = this.checkEdgeWeightContext(points, center, diagram);
        if (weightAction) {
            return weightAction;
        }

        // 4. Prüfen, ob der Stroke offen ist (Linie / Gekrümmte Kante)
        if (this.isOpenStroke(points)) {
            return this.processLine(points, diagram);
        }

        // 5. Stroke-Form für geschlossene Formen (Nodes) erkennen
        if (pathLength(points) < SketchRecognitionPipeline.MIN_STROKE_PATH_LENGTH_FOR_SHAPES) {
            return {type: 'none'};
        }

        let minConfidence = SketchRecognitionPipeline.MIN_CONFIDENCE;

        const minEdgeDist = this.getMinEdgeDistance(center, diagram);
        if (minEdgeDist < 60) {
            // Wenn sich die Mitte des Strokes nahe an der Mitte einer Kante befindet (innerhalb von 60px), ist eine deutlich höhere Confidence (z. B. 0,85) erforderlich, um
            // eine versehentliche Node-Erstellung in der Nähe von Edges zu verhindern
            minConfidence = Math.max(minConfidence, 0.85);
        }

        if (bestCandidate.confidence < minConfidence) {
            return {type: 'none'};
        }

        switch (bestCandidate.shape) {
                case 'scribble':
                    return this.processScribble(points, diagram);

                case 'circle':
                    return this.processNodeShape(points, 'place');

                case 'rectangle':
                    return this.processNodeShape(points, 'transition');

                default:
                    return {type: 'none'};
        }
    }

    processMultiStrokeInPlace(strokes: StrokePoint[][], placeNode: IDiagramNode): ResolvedAction {
        const diagram = this.config.getDiagram();
        if (!diagram) {
            return {type: 'none'};
        }

        const digit = this.recognizeDigitFromStrokes(strokes);
        const incrementCount = digit === undefined ? strokes.length : undefined; // Wenn keine Ziffer erkannt wurde: Token-Count um die Anzahl der Strokes inkrementieren
        return this.ambiguityResolver.resolveTokenContext(placeNode, digit, incrementCount);
    }

    processMultiStrokeForEdge(strokes: StrokePoint[][], edge: DiagramEdge): ResolvedAction {
        const diagram = this.config.getDiagram();
        if (!diagram) {
            return {type: 'none'};
        }

        const digit = this.recognizeDigitFromStrokes(strokes);
        if (digit !== undefined) {
            return {
                type: 'setEdgeWeight',
                sourceId: edge.source.id,
                targetId: edge.target.id,
                weight: digit
            };
        }

        return {type: 'none'};
    }

    private recognizeDigitFromStrokes(strokes: StrokePoint[][]): number | undefined {
        if (this.config.digitRecognizer.recognizeMultiStroke) {
            const multiResult = this.config.digitRecognizer.recognizeMultiStroke(strokes);
            if (multiResult) {
                return multiResult.digit;
            }
        }

        // Fallback: Einzel-Erkennung auf dem letzten Stroke (nur wenn strokes.length > 1, da recognizeMultiStroke für strokes.length === 1 bereits denselben Check macht)
        if (strokes.length > 1) {
            const lastStroke = strokes[strokes.length - 1];
            const singleResult = this.config.digitRecognizer.recognize(lastStroke);
            if (singleResult) {
                return singleResult.digit;
            }
        }

        return undefined;
    }

    public checkScribble(points: StrokePoint[]): boolean {
        if (points.length < 2) {
            return false;
        }
        const recognitionResult = this.config.recognizer.recognize(points);
        return recognitionResult.best.shape === 'scribble' && recognitionResult.best.confidence >= 0.8;
    }

    public findPlaceContainingStroke(points: StrokePoint[], diagram: Diagram): IDiagramNode | null {
        for (const node of diagram.nodes) {
            if (node.kind !== 'place') {
                continue;
            }
            const nx = node.x();
            const ny = node.y();

            // Prüfen, ob mindestens 80 % der Punkte des Strokes innerhalb der Stellen-Boundary liegen (mit etwas Toleranz)
            const insideCount = points.filter(p => {
                const d = Math.hypot(p.x - nx, p.y - ny);
                return d < (PLACE_RADIUS + 5);
            }).length;

            if (insideCount / points.length >= 0.8) {
                return node;
            }
        }
        return null;
    }


    private processShapeOnEmptyCanvas(points: StrokePoint[]): ResolvedAction {
        if (this.isOpenStroke(points)) {
            return {type: 'none'};
        }
        if (pathLength(points) < SketchRecognitionPipeline.MIN_STROKE_PATH_LENGTH_FOR_SHAPES) {
            return {type: 'none'};
        }

        const result = this.config.recognizer.recognize(points);

        if (result.best.confidence < SketchRecognitionPipeline.MIN_CONFIDENCE) {
            return {type: 'none'};
        }

        const bbox = computeBoundingBox(points);

        if (result.best.shape === 'circle') {
            return {type: 'addPlace', center: {x: bbox.cx, y: bbox.cy}};
        }
        if (result.best.shape === 'rectangle') {
            return {type: 'addTransition', center: {x: bbox.cx, y: bbox.cy}};
        }
        return {type: 'none'};
    }

    private processNodeShape(points: StrokePoint[], preferredKind: 'place' | 'transition'): ResolvedAction {
        const bbox = computeBoundingBox(points);
        const center = {x: bbox.cx, y: bbox.cy};

        if (preferredKind === 'place') {
            return {type: 'addPlace', center};
        }
        return {type: 'addTransition', center};
    }

    private processLine(points: StrokePoint[], diagram: Diagram): ResolvedAction {
        const start = points[0];
        const end = points[points.length - 1];
        const SNAP_RADIUS = PLACE_RADIUS + 15;

        const sourceNode = this.findNearestNode(start, diagram, SNAP_RADIUS);
        const targetNode = this.findNearestNode(end, diagram, SNAP_RADIUS);

        if (!sourceNode) {
            return {type: 'none'};
        }

        if (targetNode) {
            if (sourceNode.id === targetNode.id) {
                return {type: 'none'}; // Self-loop nicht erlaubt
            }

            // Bipartite Graph-Regel prüfen
            return this.ambiguityResolver.resolveEdgeConflict(sourceNode, targetNode, diagram);
        }

        // Linie endet im leeren Raum -> neuen Node des komplementären Typs erstellen
        const newKind = this.ambiguityResolver.resolveNewNodeKind(sourceNode);
        return {
            type: 'addEdgeWithNewNode',
            sourceId: sourceNode.id,
            targetPos: {x: end.x, y: end.y},
            newNodeKind: newKind
        };
    }

    private processScribble(points: StrokePoint[], diagram: Diagram): ResolvedAction {
        const deleteNodeIds: string[] = [];
        const deleteEdgeKeys: string[] = [];

        // Alle Nodes finden, die vom Scribble-Stroke geschnitten werden
        for (const node of diagram.nodes) {
            if (points.some(p => hitTestSvgPoint(node, p))) {
                deleteNodeIds.push(node.id);
            }
        }

        // Edges finden, die durch den Scribble-Bereich verlaufen
        for (const edge of diagram.edges) {
            // Edges überspringen, deren Nodes bereits gelöscht werden
            if (deleteNodeIds.includes(edge.source.id) || deleteNodeIds.includes(edge.target.id)) {
                continue;
            }
            for (const point of points) {
                if (isSvgPointNearSegment(edge, point, 0)) {
                    deleteEdgeKeys.push(`${edge.source.id}|${edge.target.id}`);
                    break;
                }
            }
        }

        if (deleteNodeIds.length === 0 && deleteEdgeKeys.length === 0) {
            return {type: 'none'};
        }

        return {type: 'delete', targetIds: deleteNodeIds, edgeKeys: deleteEdgeKeys};
    }


    private checkTokenContext(points: StrokePoint[], center: { x: number; y: number }, diagram: Diagram): ResolvedAction | null {
        const bbox = computeBoundingBox(points);
        const isSmall = bbox.w < PLACE_RADIUS && bbox.h < PLACE_RADIUS;

        if (!isSmall) {
            return null;
        }

        const containingPlace = diagram.nodes.find(
            node => node.kind === 'place' && hitTestSvgPoint(node, center)
        );

        if (!containingPlace) {
            return null;
        }

        // Zuerst Ziffernerkennung versuchen
        const digitResult = this.config.digitRecognizer.recognize(points);
        return this.ambiguityResolver.resolveTokenContext(containingPlace, digitResult?.digit);
    }

    private checkEdgeWeightContext(points: StrokePoint[], center: { x: number; y: number }, diagram: Diagram): ResolvedAction | null {
        const bbox = computeBoundingBox(points);
        const isSmall = bbox.w < 60 && bbox.h < 60;

        if (!isSmall || diagram.edges.length === 0) {
            return null;
        }

        const isInArea = this.ambiguityResolver.isPointWithinEdgeWeightArea(center, diagram);
        if (isInArea) {
            const digitResult = this.config.digitRecognizer.recognize(points);
            if (digitResult) {
                const action = this.ambiguityResolver.resolveEdgeWeightContext(center, digitResult.digit, diagram);
                if (action) {
                    return action;
                }
            }
            return {type: 'none'};
        }

        return null;
    }


    private findNearestNode(point: { x: number; y: number }, diagram: Diagram, maxDistance: number): IDiagramNode | null {
        let nearest: IDiagramNode | null = null;
        let minDist = maxDistance;

        for (const node of diagram.nodes) {
            const d = distance(point, {x: node.x(), y: node.y()});
            if (d < minDist) {
                minDist = d;
                nearest = node;
            }
        }
        return nearest;
    }

    private getMinEdgeDistance(center: { x: number; y: number }, diagram: Diagram): number {
        if (diagram.edges.length === 0) {
            return Infinity;
        }
        let minDist = Infinity;
        for (const edge of diagram.edges) {
            const mid = this.ambiguityResolver.computeEdgeMidpoint(edge);
            const d = distance(center, mid);
            if (d < minDist) {
                minDist = d;
            }
        }
        return minDist;
    }

    private isOpenStroke(points: StrokePoint[]): boolean {
        if (points.length < 2) {
            return false;
        }
        const totalPath = pathLength(points);
        if (totalPath < 30) {
            return false;
        }
        const directDist = distance(points[0], points[points.length - 1]);
        return (directDist / totalPath) > 0.38;
    }

}
