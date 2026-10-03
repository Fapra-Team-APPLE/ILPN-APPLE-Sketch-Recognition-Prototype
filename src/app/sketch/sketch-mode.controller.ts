import {signal} from '@angular/core';
import {Diagram} from '../classes/diagram/diagram';
import {IDiagramNode} from '../classes/diagram/diagram-types';
import {convertGlobalToSvgCoordinates, hitTest} from '../components/shared/canvas-helper';
import {DiagramMutator} from './actions/diagram-mutator';
import {SelectionManager} from './interaction/selection-manager';
import {TapDetector} from './interaction/tap-detector';
import {SketchRecognitionPipeline} from './pipeline/sketch-recognition-pipeline';
import {EnhancedOneDollarRecognizer} from './recognizers/enhanced-one-dollar-recognizer';
import {computeBoundingBox, ResolvedAction, StrokePoint} from './recognizers/recognition-types';
import {TensorFlowDigitRecognizer} from './recognizers/tensor-flow-digit-recognizer';
import {StrokeCollector} from './stroke-collector';


export interface SketchModeConfig {
    getSelectedTool(): string | undefined | null;
    getDiagram(): Diagram | null;
    setDiagram(diagram: Diagram | null): void;
    findSvgForEventTarget(target: EventTarget | null): SVGSVGElement | null;
    getNodeDimension(id: string): { w: number; h: number };
    startEditingNodeLabel(id: string): void;
    saveHistoryStep(): void;
    undo(): void;
    redo(): void;
    getSubMode?(): string | undefined | null;
}


/**
 * Haupt-Controller für die Sketch-Recognition-Interaktion
 *
 * Verwaltet die Sketch Pipeline mit folgenden Schritten:
 * 1. Strokes sammeln via StrokeCollector
 * 2. Klassifizieren via TapDetector
 * 3. Bei Tap: Auswahl / Label-Editing
 * 4. Bei Stroke: SketchRecognitionPipeline
 * 5. Aktion anwenden via DiagramMutator
 */
export class SketchModeController {

    private static readonly MAX_TOUCH_CONTACT_SIZE = 100; // Maximale Kontaktfläche (px) für Touch-Events (für Palm-Rejection)

    private readonly strokeCollector = new StrokeCollector();
    private readonly tapDetector = new TapDetector();
    private readonly selectionManager = new SelectionManager();
    private readonly mutator = new DiagramMutator();
    private readonly pipeline: SketchRecognitionPipeline;

    private activeSvg: SVGSVGElement | null = null;
    private strokePreviewElement: SVGPolylineElement | null = null;
    private activePointerId: number | null = null;

    private dragState: {
        node: IDiagramNode;
        startX: number;
        startY: number;
        startNodeX: number;
        startNodeY: number;
        hasStartedMoving?: boolean;
        isDirectDrag?: boolean;
    } | null = null;

    readonly selectedNodeId = this.selectionManager.selectedNodeId;

    readonly currentStrokePoints = signal<string>(''); // SVG points string

    private readonly boundPointerMove = this.onPointerMove.bind(this);
    private readonly boundPointerUp = this.onPointerUp.bind(this);
    private readonly boundKeyDown = this.onKeyDown.bind(this);


    // Wie lange nach einem Stroke in einer Stelle oder in der Nähe einer Kante gewartet wird, bevor die Recognition durchgeführt wird
    private static readonly MULTI_STROKE_TIMEOUT_MS = 700;

    private multiStrokeBuffer: {
        placeId?: string;
        edgeKey?: string;
        strokes: StrokePoint[][];
        timerId: ReturnType<typeof setTimeout>;
        previewElements: SVGPolylineElement[]; // SVG-Polyline-Elemente für jeden gepufferten Stroke
    } | null = null;

    constructor(private readonly config: SketchModeConfig) {
        this.pipeline = new SketchRecognitionPipeline({
            recognizer: new EnhancedOneDollarRecognizer(),
            digitRecognizer: new TensorFlowDigitRecognizer(),
            getDiagram: () => this.config.getDiagram(),
            getSvg: () => this.activeSvg
        });
        window.addEventListener('keydown', this.boundKeyDown);
    }

    onCanvasPointerDown(event: PointerEvent): void {
        if (!event.isPrimary) {
            return;
        }
        // Palm Rejection: Touch-Events mit großer Kontaktfläche (Handballen) ignorieren
        if (event.pointerType === 'touch') {
            const contactSize = Math.max(event.width, event.height);
            if (contactSize > SketchModeController.MAX_TOUCH_CONTACT_SIZE) {
                return;
            }
        }
        if (!this.isSketchModeActive()) {
            return;
        }
        this.activePointerId = event.pointerId;

        const svg = this.config.findSvgForEventTarget(event.currentTarget);
        if (!svg) {
            return;
        }
        this.activeSvg = svg;

        const svgCoords = convertGlobalToSvgCoordinates(svg, event.clientX, event.clientY);
        if (!svgCoords) {
            return;
        }

        const point: StrokePoint = {
            x: svgCoords.x,
            y: svgCoords.y,
            timestamp: performance.now(),
            pressure: event.pressure
        };

        const diagram = this.config.getDiagram();
        const hitNode = diagram?.nodes.find(n => hitTest(svg, n, event.clientX, event.clientY, this.config.getNodeDimension(n.id), true));

        if (this.multiStrokeBuffer) {
            let isSameContext = false;
            if (this.multiStrokeBuffer.placeId && hitNode && hitNode.id === this.multiStrokeBuffer.placeId) {
                isSameContext = true;
            } else if (this.multiStrokeBuffer.edgeKey && diagram) {
                const checkPoint = {x: svgCoords.x, y: svgCoords.y};
                const matchingEdge = this.pipeline.ambiguityResolver.findEdgeForWeightStroke(checkPoint, diagram);
                if (matchingEdge && `${matchingEdge.source.id}|${matchingEdge.target.id}` === this.multiStrokeBuffer.edgeKey) {
                    isSameContext = true;
                }
            }

            if (isSameContext) {
                // Gleicher Context (Place oder Edge): Timer aussetzen, damit er nicht mitten im Zeichnen des nächsten Strokes feuert
                clearTimeout(this.multiStrokeBuffer.timerId);
            } else {
                // Anderer Context: sofort commiten
                this.flushMultiStrokeBuffer();
            }
        }

        // Drag-and-Drop für selektierte Knoten ermöglichen
        // - Im draw-Modus: auch mit Stift erlaubt
        // - Im move-Modus: nur mit Touch/Mouse (nicht mit Stift)
        const isAllowedForPointerType = event.pointerType !== 'pen' || this.config.getSubMode?.() === 'draw';
        if (isAllowedForPointerType && hitNode && this.selectionManager.isSelected(hitNode.id)) {
            // Bereits selektiert -> Drag starten
            this.dragState = {
                node: hitNode,
                startX: event.clientX,
                startY: event.clientY,
                startNodeX: hitNode.x(),
                startNodeY: hitNode.y()
            };
            // Drag gestartet -> alle ausstehenden Strokes sofort commiten/flushen
            this.flushMultiStrokeBuffer();
        }

        // Stroke-Collection und Preview nur starten, wenn KEINE selektierte Node gedraggt wird
        if (!this.dragState) {
            this.strokeCollector.beginStroke(point);
            this.createStrokePreview(svg);
        }

        this.cleanupListeners();
        window.addEventListener('pointermove', this.boundPointerMove);
        window.addEventListener('pointerup', this.boundPointerUp);
        window.addEventListener('pointercancel', this.boundPointerUp);

        event.preventDefault();
        event.stopPropagation();
    }

    startDirectDrag(event: PointerEvent, node: IDiagramNode): void {
        if (!this.isSketchModeActive()) {
            return;
        }
        this.activePointerId = event.pointerId;
        const svg = this.config.findSvgForEventTarget(event.currentTarget);
        if (svg) {
            this.activeSvg = svg;
        }

        this.dragState = {
            node,
            startX: event.clientX,
            startY: event.clientY,
            startNodeX: node.x(),
            startNodeY: node.y(),
            isDirectDrag: true
        };

        this.flushMultiStrokeBuffer();
        this.removeStrokePreview();
        this.strokeCollector.reset();

        this.cleanupListeners();
        window.addEventListener('pointermove', this.boundPointerMove);
        window.addEventListener('pointerup', this.boundPointerUp);
        window.addEventListener('pointercancel', this.boundPointerUp);

        event.preventDefault();
        event.stopPropagation();
    }

    onNodePointerDown(event: PointerEvent): void {
        if (!this.isSketchModeActive()) {
            return;
        }
        // Dem Canvas-Handler alles überlassen (dieser führt bereits das Hit-Testing durch)
        this.onCanvasPointerDown(event);
    }

    destroy(): void {
        this.cleanupListeners();
        this.removeStrokePreview();
        this.flushMultiStrokeBuffer();
        this.selectionManager.clear();
        this.activePointerId = null;
        this.dragState = null;
        window.removeEventListener('keydown', this.boundKeyDown);
    }

    clearSelection(): void {
        this.selectionManager.clear();
    }


    private onPointerMove(event: PointerEvent): void {
        if (event.pointerId !== this.activePointerId) {
            return;
        }
        const svg = this.activeSvg;
        if (!svg) {
            return;
        }

        const svgCoords = convertGlobalToSvgCoordinates(svg, event.clientX, event.clientY);
        if (!svgCoords) {
            return;
        }

        if (this.dragState) {
            const dx = event.clientX - this.dragState.startX;
            const dy = event.clientY - this.dragState.startY;
            const dist = Math.hypot(dx, dy);

            // Position nur aktualisieren, wenn tatsächlich mit dem Draggen begonnen wurde (Bewegung >= 5px) (verhindert unbeabsichtigte kleine Bewegungen beim erneute Tippen
            // auf die Node zur Label-Bearbeitung)
            if (this.dragState.hasStartedMoving || dist >= 5) {
                if (!this.dragState.hasStartedMoving) {
                    this.config.saveHistoryStep();
                    this.dragState.hasStartedMoving = true;
                }
                this.dragState.node.setX(this.dragState.startNodeX + dx);
                this.dragState.node.setY(this.dragState.startNodeY + dy);
            }
            // Stroke-Points während des Draggens nicht sammeln
            return;
        }

        const point: StrokePoint = {
            x: svgCoords.x,
            y: svgCoords.y,
            timestamp: performance.now(),
            pressure: event.pressure
        };

        this.strokeCollector.addPoint(point);
        this.updateStrokePreview();
    }

    private onPointerUp(event: PointerEvent): void {
        if (event.pointerId !== this.activePointerId) {
            return;
        }
        this.cleanupListeners();
        this.activePointerId = null;

        if (this.dragState) { // Abschluss des Draggens behandeln
            const dx = event.clientX - this.dragState.startX;
            const dy = event.clientY - this.dragState.startY;
            const dist = Math.hypot(dx, dy);
            const draggedNode = this.dragState.node;
            const isDirectDrag = this.dragState.isDirectDrag;

            this.dragState = null;
            this.strokeCollector.reset();

            if (dist < 5) {
                if (isDirectDrag) {
                    // Single Tap im Verschieben-Modus: Direkt Label-Editor öffnen
                    this.config.startEditingNodeLabel(draggedNode.id);
                    this.selectionManager.clear();
                } else {
                    // Wenn der Benutzer sich kaum bewegt hat (weniger als 5 Pixel), als Tap/Klick zur Label-Bearbeitung behandeln
                    const svg = this.activeSvg;
                    const diagram = this.config.getDiagram();
                    if (svg && diagram) {
                        this.handleTap(event, svg, diagram);
                    }
                }
            }
            return;
        }

        const points = this.strokeCollector.endStroke();

        if (points.length === 0) {
            this.removeStrokePreview();
            this.flushMultiStrokeBuffer();
            return;
        }

        const svg = this.activeSvg;
        const diagram = this.config.getDiagram();

        const classification = this.tapDetector.classify(points);

        if (classification === 'tap') {
            this.removeStrokePreview();
            this.flushMultiStrokeBuffer();
            if (this.config.getSubMode?.() === 'move') {
                // Im Verschieben-Modus selektiert ein Stift-Tap keinen Knoten
                this.selectionManager.clear();
                this.handleStroke(points);
            } else {
                this.handleTap(event, svg, diagram);
            }
        } else {
            this.handleStroke(points);
        }
    }


    private handleTap(
        event: PointerEvent,
        svg: SVGSVGElement | null,
        diagram: Diagram | null
    ): void {
        if (!svg || !diagram) {
            this.selectionManager.tapOnCanvas();
            return;
        }

        const hitNode = diagram.nodes.find(n => hitTest(svg, n, event.clientX, event.clientY, this.config.getNodeDimension(n.id), true));

        if (!hitNode || this.config.getSubMode?.() === 'move') {
            this.selectionManager.tapOnCanvas();
            return;
        }

        const result = this.selectionManager.tapOnNode(hitNode);

        if (result === 'label') {
            this.config.startEditingNodeLabel(hitNode.id);
            this.selectionManager.clear();
        }
    }


    private handleStroke(points: StrokePoint[]): void {
        const diagram = this.config.getDiagram();

        if (diagram) {
            // Prüfen, ob sich dieser Stroke vollständig in einer Stelle befindet
            const containingPlace = this.pipeline.findPlaceContainingStroke(points, diagram);
            if (containingPlace) {
                const isScribble = this.pipeline.checkScribble(points);

                // Nur sofort verarbeiten, wenn es ein Scribble oder ein Token ist
                // Alle anderen Strokes innerhalb eines Places werden in den Buffer gelegt, um Multi-Stroke-Ziffern zu unterstützen (für Multi-Stroke-Zahlen wie "4")
                let isToken = false;
                if (!isScribble) {
                    const recognitionResult = this.pipeline.config.recognizer.recognize(points);
                    isToken = recognitionResult.best.shape === 'circle' || recognitionResult.best.shape === 'dot'
                        || this.pipeline.config.digitRecognizer.recognize(points)?.digit === 0;
                }

                if (isScribble || isToken) {
                    this.processImmediateStroke(points);
                } else {
                    this.bufferAndReleasePreview(points, containingPlace.id);
                }
                return;
            }

            // Prüfen, ob dieser Stroke in einem Edge-Weight-Bereich liegt
            const bbox = computeBoundingBox(points);
            const isSmall = bbox.w < 60 && bbox.h < 60;
            if (isSmall) {
                const center = {x: bbox.cx, y: bbox.cy};
                const matchingEdge = this.pipeline.ambiguityResolver.findEdgeForWeightStroke(center, diagram);
                if (matchingEdge) {
                    const isScribble = this.pipeline.checkScribble(points);
                    if (isScribble) {
                        this.processImmediateStroke(points);
                    } else {
                        const edgeKey = `${matchingEdge.source.id}|${matchingEdge.target.id}`;
                        this.bufferAndReleasePreview(points, undefined, edgeKey);
                    }
                    return;
                }
            }
        }

        this.processImmediateStroke(points);
    }

    /**
     * Verarbeitet einen Stroke sofort (ohne Pufferung)
     */
    private processImmediateStroke(points: StrokePoint[]): void {
        this.removeStrokePreview();
        this.flushMultiStrokeBuffer();
        const action = this.pipeline.processStroke(points);
        this.applyAction(action);
    }

    private bufferAndReleasePreview(points: StrokePoint[], placeId?: string, edgeKey?: string): void {
        const preview = this.strokePreviewElement;
        this.strokePreviewElement = null;
        this.bufferStroke(points, preview, placeId, edgeKey);
    }


    private bufferStroke(points: StrokePoint[], preview: SVGPolylineElement | null, placeId?: string, edgeKey?: string): void {
        const isDifferentContext = this.multiStrokeBuffer && (
            this.multiStrokeBuffer.placeId !== placeId ||
            this.multiStrokeBuffer.edgeKey !== edgeKey
        );

        if (isDifferentContext) {
            this.flushMultiStrokeBuffer();
        }

        if (this.multiStrokeBuffer) {
            clearTimeout(this.multiStrokeBuffer.timerId);
            this.multiStrokeBuffer.strokes.push(points);
            if (preview) {
                this.multiStrokeBuffer.previewElements.push(preview);
            }
        } else {
            this.multiStrokeBuffer = {
                placeId,
                edgeKey,
                strokes: [points],
                timerId: 0 as unknown as ReturnType<typeof setTimeout>,
                previewElements: preview ? [preview] : []
            };
        }

        this.multiStrokeBuffer.timerId = setTimeout(
            () => this.commitMultiStrokeBuffer(),
            SketchModeController.MULTI_STROKE_TIMEOUT_MS
        );
    }

    /**
     * Committet die gepufferte Multi-Stroke-Ziffernerkennung und wendet das Ergebnis an
     */
    private commitMultiStrokeBuffer(): void {
        const buffer = this.multiStrokeBuffer;
        this.multiStrokeBuffer = null;

        if (buffer) {
            for (const el of buffer.previewElements) {
                el.remove();
            }
        }

        if (!buffer || buffer.strokes.length === 0) {
            return;
        }

        const diagram = this.config.getDiagram();
        if (!diagram) {
            return;
        }

        if (buffer.placeId) {
            const placeNode = diagram.nodes.find(n => n.id === buffer.placeId);
            if (!placeNode) {
                return;
            }
            const action = this.pipeline.processMultiStrokeInPlace(buffer.strokes, placeNode);
            this.applyAction(action);
        } else if (buffer.edgeKey) {
            const edge = diagram.edges.find(e => `${e.source.id}|${e.target.id}` === buffer.edgeKey);
            if (!edge) {
                return;
            }
            const action = this.pipeline.processMultiStrokeForEdge(buffer.strokes, edge);
            this.applyAction(action);
        }
    }

    private applyAction(action: ResolvedAction): void {
        if (action.type === 'none' || action.type === 'rejected') {
            return;
        }
        const diagram = this.config.getDiagram();
        if (!diagram && action.type !== 'addPlace' && action.type !== 'addTransition') {
            return;
        }
        this.config.saveHistoryStep();
        const activeDiagram = diagram ?? new Diagram([]);
        const result = this.mutator.apply(action, activeDiagram);
        if (result) {
            if (result !== diagram) {
                this.config.setDiagram(result);
            } else {
                this.config.setDiagram(result.clone());
            }
        }
    }

    private flushMultiStrokeBuffer(): void {
        if (this.multiStrokeBuffer) {
            clearTimeout(this.multiStrokeBuffer.timerId);
            this.commitMultiStrokeBuffer();
        }
    }


    private createStrokePreview(svg: SVGSVGElement): void {
        this.removeStrokePreview();
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', '#2196F3');
        polyline.setAttribute('stroke-width', '2');
        polyline.setAttribute('stroke-linecap', 'round');
        polyline.setAttribute('stroke-linejoin', 'round');
        polyline.setAttribute('pointer-events', 'none');
        polyline.setAttribute('opacity', '0.7');
        polyline.classList.add('sketch-stroke-preview');
        svg.appendChild(polyline);
        this.strokePreviewElement = polyline;
    }

    private updateStrokePreview(): void {
        if (!this.strokePreviewElement) {
            return;
        }
        const points = this.strokeCollector.points;
        const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
        this.strokePreviewElement.setAttribute('points', pointsStr);
        this.currentStrokePoints.set(pointsStr);
    }

    private removeStrokePreview(): void {
        if (this.strokePreviewElement) {
            this.strokePreviewElement.remove();
            this.strokePreviewElement = null;
        }
        this.currentStrokePoints.set('');
    }


    private isSketchModeActive(): boolean {
        return this.config.getSelectedTool() === 'sketch';
    }

    private cleanupListeners(): void {
        window.removeEventListener('pointermove', this.boundPointerMove);
        window.removeEventListener('pointerup', this.boundPointerUp);
        window.removeEventListener('pointercancel', this.boundPointerUp);
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (!this.isSketchModeActive()) {
            return;
        }
        const target = event.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            if (event.key?.toLowerCase() === 'z') {
                event.preventDefault();
                if (event.shiftKey) {
                    this.config.redo();
                } else {
                    this.config.undo();
                }
            } else if (event.key?.toLowerCase() === 'y') {
                event.preventDefault();
                this.config.redo();
            }
        }
    }

}
