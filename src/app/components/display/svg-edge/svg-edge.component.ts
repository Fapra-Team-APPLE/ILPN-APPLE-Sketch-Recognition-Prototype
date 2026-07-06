import {CommonModule} from '@angular/common';
import {Component, computed, effect, ElementRef, inject, input, signal, Signal, untracked} from '@angular/core';
import {DiagramEdge} from '../../../classes/diagram/diagram-edge';
import {Coords} from '../../../classes/json-petri-net';
import {SvgDefsIdContextDirective} from '../../../directives/svg-defs-id-context.directive';
import {NodeDimensionService} from '../../../services/node-dimension.service';
import {bezierPoint, bringToFront, getEffectiveWaypoints, getLoopPathData} from '../../shared/canvas-helper';
import {InlineEditableLabelComponentBase} from '../svg-node/shared/inline-edit-base';
import {calculateEdgeEndpoint} from '../svg-node/svg-node';

@Component({
    selector: 'g[SvgEdge]',
    templateUrl: './svg-edge.component.html',
    styleUrl: './svg-edge.component.scss',
    imports: [CommonModule],
    host: {
        '[class.hints-disabled]': '!showHints()'
    }
})
export class SvgEdgeComponent extends InlineEditableLabelComponentBase<DiagramEdge> {

    static arrowHeadCounter = 0;
    readonly arrowHeadId = `arrowhead-${SvgEdgeComponent.arrowHeadCounter++}`;

    readonly svgDefsIdSuffix = inject(SvgDefsIdContextDirective, {optional: true})?.idSuffix;
    private dimService = inject(NodeDimensionService);
    private readonly elementRef: ElementRef<SVGGElement> = inject(ElementRef);

    readonly edge = input<DiagramEdge>();
    readonly allowEdgeWeightModification = input<boolean>(false);
    readonly allowEdgeLabelModification = input<boolean>(false);
    readonly showHints = input<boolean>(true);
    readonly requestEdit = input<boolean>(false);

    readonly validationStatus = computed(() => this.edge()?.validity()?.status);

    readonly hovered = signal(false);
    readonly showControls = computed(() => !this.readonlyMode() && this.allowEdgeWeightModification() && this.hovered());

    private readonly pointsList: Signal<Coords[]> = computed(() => {
        const e = this.edge();
        if (!e) {
            return [];
        }

        const waypoints = getEffectiveWaypoints(e);
        const targetPoint = {x: e.target.x(), y: e.target.y()};
        const targetDim = this.dimService.getDimension(e.target.id)();
        const sourceDim = this.dimService.getDimension(e.source.id)();
        const points = [
            {x: e.source.x(), y: e.source.y()},
            ...waypoints,
            targetPoint
        ];

        // Startpunkt auf Rand des Source-Knotens verschieben
        let pointAfterSource = points[1];
        if (pointAfterSource.x === points[0].x && pointAfterSource.y === points[0].y) {
            for (let i = 2; i < points.length; i++) {
                const candidate = points[i];
                if (candidate.x !== points[0].x || candidate.y !== points[0].y) {
                    pointAfterSource = candidate;
                    break;
                }
            }
        }

        points[0] = calculateEdgeEndpoint(
            pointAfterSource,
            points[0],
            e.source.kind,
            sourceDim.w,
            sourceDim.h
        );

        // letzten Punkt vor Target zur Richtungsbestimmung finden
        let pointBeforeTarget = points[points.length - 2];

        if (pointBeforeTarget.x === targetPoint.x && pointBeforeTarget.y === targetPoint.y) {
            for (let i = points.length - 3; i >= 0; i--) {
                const candidate = points[i];
                if (candidate.x !== targetPoint.x || candidate.y !== targetPoint.y) {
                    pointBeforeTarget = candidate;
                    break;
                }
            }
        }

        points[points.length - 1] = calculateEdgeEndpoint(
            pointBeforeTarget,
            targetPoint,
            e.target.kind,
            targetDim.w,
            targetDim.h
        );

        return points;
    });

    readonly pathData = computed(() => {
        const e = this.edge();
        if (!e) {
            return '';
        }

        const points = this.pointsList();

        // Wenn Schleife ohne Wegpunkte: Darstellung als Bezier-Kurve
        if (this.isLoopWithoutWaypoints(e, points)) {
            const nodeDimensions = this.dimService.getDimension(e.source.id)();
            return getLoopPathData(e.source, nodeDimensions.w, nodeDimensions.h);
        }

        return points.map((p, i) => (i === 0 ? 'M' : 'L') + ` ${p.x} ${p.y}`).join(' ');
    });

    readonly midPoint = computed(() => {
        const pts = this.pointsList();
        if (pts.length === 0) {
            return {x: 0, y: 0};
        }

        const e = this.edge();

        // Wenn Schleife ohne Wegpunkte: Mittelpunkt am Scheitel der Bezier-Kurve
        if (e && this.isLoopWithoutWaypoints(e, pts)) {
            return bezierPoint(0.5, pts);
        }

        const midIdx = Math.floor((pts.length - 1) / 2);
        const a = pts[midIdx];
        const b = pts[midIdx + 1] ?? a;
        return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
    });

    readonly weight = computed(() => this.edge()?.weight() ?? 1);


    constructor() {
        super();
        // Wenn requestEdit auf true springt -> Edit-Modus aktivieren
        effect(() => {
            if (this.requestEdit()) {
                untracked(() => this.startEditing(this.label() + ', '));
            }
        });

        this.requestFront.subscribe(() => bringToFront(this.elementRef.nativeElement));
    }

    onGroupHoverStart(): void {
        this.hovered.set(true);
    }

    onGroupHoverStop(): void {
        this.hovered.set(false);
    }

    incrementWeight(): void {
        this.edge()?.incrementWeight();
    }

    decrementWeight(): void {
        const edge = this.edge();
        if (edge && edge.weight() > 1) {
            edge.decrementWeight();
        }
    }

    protected override getDiagramNodeOrEdge(): DiagramEdge | undefined {
        return this.edge();
    }

    protected override getEditBoxSvgCenter(): { x: number; y: number } | undefined {
        const mid = this.midPoint();
        return {
            x: mid.x,
            y: mid.y - 9
        };
    }

    private isLoopWithoutWaypoints(edge: DiagramEdge, points: Coords[]) {
        return edge.source.id === edge.target.id && edge.waypoints().length === 0 && points.length === 4;
    }

}
