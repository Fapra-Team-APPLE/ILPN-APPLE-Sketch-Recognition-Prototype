import {signal} from '@angular/core';
import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {IDiagramNode} from '../../classes/diagram/diagram-types';
import {Coords} from '../../classes/json-petri-net';
import {NodeDimensionService} from '../../services/node-dimension.service';
import {calculateNodeMargins, CANVAS_PADDING} from '../display/svg-node/svg-node';

export class CanvasPanningController {

    private _isPanning = signal(false);
    readonly isPanning = this._isPanning.asReadonly();

    private lastPointerPosition: Coords = {x: 0, y: 0};
    private canvasDimensions = {width: 0, height: 0};

    constructor(
        private readonly options: {
            canStartPanning: () => boolean,
            diagram: () => Diagram<IDiagramNode, DiagramEdge> | undefined | null,
            nodeDimensionService: NodeDimensionService,
            ignoreBoundaries?: boolean
        }
    ) {
    }

    onPointerDown(event: PointerEvent) {
        if (!this.options.canStartPanning()) {
            return;
        }

        if (event.target === event.currentTarget) {
            const svgEl = (event.target as Element).closest('svg');
            if (svgEl) {
                this.canvasDimensions = {width: svgEl.clientWidth, height: svgEl.clientHeight};
            }

            this._isPanning.set(true);
            this.lastPointerPosition = {x: event.clientX, y: event.clientY};

            if (event.target instanceof Element) {
                event.target.setPointerCapture(event.pointerId);
            }
        }
    }

    onPointerMove(event: PointerEvent) {
        if (this.isPanning()) {
            const dx = event.clientX - this.lastPointerPosition.x;
            const dy = event.clientY - this.lastPointerPosition.y;
            this.lastPointerPosition = {x: event.clientX, y: event.clientY};
            this.moveDiagram(dx, dy);
        }
    }

    onPointerUp(event: PointerEvent) {
        if (this.isPanning()) {
            this._isPanning.set(false);
            if (event.target instanceof Element) {
                event.target.releasePointerCapture(event.pointerId);
            }
        }
    }

    private moveDiagram(dx: number, dy: number) {
        const diagram = this.options.diagram();
        if (!diagram) {
            return;
        }

        let actualDx = dx;
        let actualDy = dy;

        if (this.options.ignoreBoundaries !== false) {
            let minDx = -Infinity;
            let maxDx = Infinity;
            let minDy = -Infinity;
            let maxDy = Infinity;

            // Einschränkungen basierend auf allen Knoten berechnen (um zu verhindern, dass Knoten außerhalb des sichtbaren Bereichs verschoben werden)
            for (const node of diagram.nodes) {
                const dim = this.options.nodeDimensionService.getDimension(node.id)();
                const margins = calculateNodeMargins(node.kind, dim);

                const nodeMinX = CANVAS_PADDING + margins.left;
                const nodeMaxX = this.canvasDimensions.width - CANVAS_PADDING - margins.right;
                const nodeMinY = CANVAS_PADDING + margins.top;
                const nodeMaxY = this.canvasDimensions.height - CANVAS_PADDING - margins.bottom;

                minDx = Math.max(minDx, nodeMinX - node.x());
                maxDx = Math.min(maxDx, nodeMaxX - node.x());

                minDy = Math.max(minDy, nodeMinY - node.y());
                maxDy = Math.min(maxDy, nodeMaxY - node.y());
            }

            actualDx = this.clamp(dx, minDx, maxDx);
            actualDy = this.clamp(dy, minDy, maxDy);
        }

        if (actualDx === 0 && actualDy === 0) {
            return;
        }

        diagram.nodes.forEach(node => {
            node.setX(node.x() + actualDx);
            node.setY(node.y() + actualDy);
        });
        diagram.edges.forEach(edge => {
            const waypoints = edge.waypoints();
            if (waypoints.length > 0) {
                edge.waypoints.set(waypoints.map(p => ({x: p.x + actualDx, y: p.y + actualDy})));
            }
        });
    }

    private clamp(value: number, min: number, max: number) {
        if (min > max) {
            return 0;
        }
        return Math.max(min, Math.min(max, value));
    }

}
