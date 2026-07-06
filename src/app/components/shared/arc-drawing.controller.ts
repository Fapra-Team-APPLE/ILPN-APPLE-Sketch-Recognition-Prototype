// Generischer, wiederverwendbarer Controller zum Zeichnen von Kanten zwischen Knoten auf einem SVG-Canvas
// Konfigurierbar, sodass sie sowohl für Petri-Netze als auch für Erreichbarkeitsgraphen verwendet werden kann

import {IDiagramEdge, IDiagramNode} from '../../classes/diagram/diagram-types';
import {getLoopPathData, hitTest} from './canvas-helper';

export interface ArcDrawingConfig<N extends IDiagramNode, E extends IDiagramEdge> {
    getSelectedTool(): string | undefined | null;
    isNodeEligible(node: N): boolean;
    isValidEdge(source: N, target: N): boolean;
    createEdge(source: N, target: N): E;
    getNodes(): readonly N[];
    getEdges(): readonly E[];
    addEdge(edge: E): void;
    addNodeAt?(x: number, y: number, source: N): N | undefined;
    findSvgForEventTarget(target: EventTarget | null): SVGSVGElement | null;
    getNodeDimension(id: string): { w: number, h: number };
}

export class ArcDrawingController<N extends IDiagramNode, E extends IDiagramEdge> {

    static arrowHeadCounter = 0;
    readonly arrowHeadId = `arc-drawing-controller-arrowhead-${ArcDrawingController.arrowHeadCounter++}`;

    private drag?: {
        source: N;
        svg: SVGSVGElement;
        tempLine: SVGPathElement;
        moveListener: (e: PointerEvent) => void;
        upListener: (e: PointerEvent) => void;
        keyDownListener: (e: KeyboardEvent) => void;
        wasMoved: boolean;
        activePointerId: number;
    };

    constructor(private readonly config: ArcDrawingConfig<N, E>) {
    }

    public onNodePointerDown(event: PointerEvent, node: N) {
        if (!event.isPrimary) {
            return;
        }
        if (this.config.getSelectedTool() !== 'arc') {
            return;
        }
        if (!this.config.isNodeEligible(node)) {
            return;
        }
        const svg = this.config.findSvgForEventTarget(event.currentTarget);
        if (!svg) {
            return;
        }
        event.stopPropagation();
        this.beginDrag(svg, node, event.pointerId);
    }

    public destroy() {
        this.cleanup();
    }


    private beginDrag(svg: SVGSVGElement, source: N, pointerId: number) {
        this.cleanup();

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('stroke', 'gray');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('d', `M ${source.x()},${source.y()} L ${source.x()},${source.y()}`);
        line.setAttribute('fill', 'none');
        line.setAttribute('pointer-events', 'none');

        const markerId = this.getOrCreateArrowHeadMarkerId(svg);
        line.setAttribute('marker-end', `url(#${markerId})`);

        svg.appendChild(line);

        const moveListener = (e: PointerEvent) => {
            if (e.pointerId !== this.drag?.activePointerId) {
                return;
            }
            if (this.drag) {
                this.drag.wasMoved = true;
            }

            const p = this.toSvgCoords(svg, e.clientX, e.clientY);
            const isHoveringSource = hitTest(svg, source, e.clientX, e.clientY);

            if (isHoveringSource && this.config.isValidEdge(source, source)) { // Schleife nur anzeigen, wenn erlaubt (gültig)
                const nodeDimension = this.config.getNodeDimension(source.id);
                const loopPathData = getLoopPathData(source, nodeDimension.w, nodeDimension.h);
                line.setAttribute('d', loopPathData);
            } else {
                line.setAttribute('d', `M ${source.x()},${source.y()} L ${p.x},${p.y}`);
            }
        };
        const upListener = (e: PointerEvent) => this.finishDrag(e, source, svg);
        const keyDownListener = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.cleanup();
            }
        };

        window.addEventListener('pointermove', moveListener);
        window.addEventListener('pointerup', upListener);
        window.addEventListener('pointercancel', upListener);
        window.addEventListener('keydown', keyDownListener);

        this.drag = {source, svg, tempLine: line, moveListener, upListener, keyDownListener, wasMoved: false, activePointerId: pointerId};
    }

    private finishDrag(e: PointerEvent, source: N, svg: SVGSVGElement) {
        if (e.pointerId !== this.drag?.activePointerId) {
            return;
        }
        const nodes = this.config.getNodes();
        if (!nodes || nodes.length === 0) {
            this.cleanup();
            return;
        }
        const target = nodes.find(n => hitTest(svg, n, e.clientX, e.clientY, this.config?.getNodeDimension(n.id)));
        if (target) {
            if (source === target && !this.drag?.wasMoved) {
                // Abbrechen, wenn Schleife gezeichnet würde, aber Cursor nicht bewegt wurde, sonst führt ein Klick auf Knoten ggf. zum unerwünschten Erstellen einer Schleife
                this.cleanup();
                return;
            }
            if (this.config.isValidEdge(source, target)) {
                const edge = this.config.createEdge(source, target);
                this.config.addEdge(edge);
            }
        } else if (this.config.addNodeAt) {
            const point = this.toSvgCoords(svg, e.clientX, e.clientY);
            const newNode = this.config.addNodeAt(point.x, point.y, source);
            if (newNode && this.config.isValidEdge(source, newNode)) {
                const edge = this.config.createEdge(source, newNode);
                this.config.addEdge(edge);
            }
        }
        this.cleanup();
    }

    private cleanup() {
        if (!this.drag) {
            return;
        }
        try {
            window.removeEventListener('pointermove', this.drag.moveListener);
            window.removeEventListener('pointerup', this.drag.upListener as EventListener);
            window.removeEventListener('pointercancel', this.drag.upListener as EventListener);
            window.removeEventListener('keydown', this.drag.keyDownListener);
            this.drag.svg.removeChild(this.drag.tempLine);
        } catch {
            // ignore
        }
        this.drag = undefined;
    }

    private toSvgCoords(svg: SVGSVGElement, clientX: number, clientY: number) {
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) {
            return {x: 0, y: 0};
        }
        const p = pt.matrixTransform(ctm.inverse());
        return {x: p.x, y: p.y};
    }

    private getOrCreateArrowHeadMarkerId(svg: SVGSVGElement): string {
        let defs = svg.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svg.prepend(defs);
        }
        let marker = defs.querySelector(`#${this.arrowHeadId}`) as SVGMarkerElement | null;
        if (!marker) {
            marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', this.arrowHeadId);
            marker.setAttribute('markerWidth', '10');
            marker.setAttribute('markerHeight', '7');
            marker.setAttribute('refX', '10');
            marker.setAttribute('refY', '3.5');
            marker.setAttribute('orient', 'auto');
            marker.setAttribute('markerUnits', 'strokeWidth');

            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
            polygon.setAttribute('fill', 'gray');
            marker.appendChild(polygon);
            defs.appendChild(marker);
        }
        return this.arrowHeadId;
    }

}

