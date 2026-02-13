import {CommonModule} from '@angular/common';
import {Component, computed, effect, ElementRef, inject, input, OnDestroy, signal} from '@angular/core';
import {DiagramNode} from '../../../classes/diagram/diagram-node';
import {IDiagramNode} from '../../../classes/diagram/diagram-types';
import {ReachabilityNode} from '../../../classes/reachability/reachability-node';
import {NodeDimensionService} from '../../../services/node-dimension.service';
import {bringToFront} from '../../shared/canvas-helper';
import {PlaceNodeComponent} from './place-node/place-node.component';
import {StateNodeComponent} from './state-node/state-node.component';
import {calculateNodeMargins, CANVAS_PADDING} from './svg-node';
import {TransitionNodeComponent} from './transition-node/transition-node.component';

@Component({
    selector: 'g[SvgNode]',
    imports: [CommonModule, PlaceNodeComponent, StateNodeComponent, TransitionNodeComponent],
    templateUrl: './svg-node.component.html',
    styleUrl: './svg-node.component.scss',
    host: {
        '[class.hints-disabled]': '!showHints()'
    }
})
export class SvgNodeComponent implements OnDestroy {

    readonly diagramNode = input<IDiagramNode>();
    readonly diagramNodes = input<IDiagramNode[]>([]);
    readonly dragAndDropEnabled = input<boolean>(false);
    readonly readonlyMode = input<boolean>(false);
    readonly placeIds = input<string[]>([]);
    readonly showHints = input<boolean>(true);
    readonly tokenGameMode = input<boolean>(false);
    readonly enforceUniqueLabels = input<boolean>(true);

    readonly allowTokenCountModification = input<boolean>(false);
    private readonly elementRef: ElementRef<SVGGElement> = inject(ElementRef);
    private readonly nodeDimensionService = inject(NodeDimensionService);

    readonly kind = computed(() => this.diagramNode()?.kind);

    // Strongly typed node accessors
    readonly placeNode = computed<DiagramNode | undefined>(() => this.kind() === 'place' ? <DiagramNode> this.diagramNode() : undefined);
    readonly transitionNode = computed<DiagramNode | undefined>(() => this.kind() === 'transition' ? <DiagramNode> this.diagramNode() : undefined);
    readonly stateNode = computed<ReachabilityNode | undefined>(() => this.kind() === 'state' ? <ReachabilityNode> this.diagramNode() : undefined);

    readonly fillColor = signal('white');

    private drag = {
        active: false,
        startMouseX: 0,
        startMouseY: 0,
        startNodeX: 0,
        startNodeY: 0,
        moveListener: undefined as ((e: PointerEvent) => void) | undefined,
        upListener: undefined as ((e: PointerEvent) => void) | undefined,
        listenerTarget: window,
        canvasWidth: 1000,
        canvasHeight: 420
    };

    constructor() {
        // Wenn Dragging zur Laufzeit deaktiviert wird, abbrechen und aufräumen
        effect(() => {
            if (!this.dragAndDropEnabled()) {
                this.finishDrag();
            }
        });
    }

    ngOnDestroy(): void {
        // Sicherheitsnetz: Falls die Komponente während eines aktiven Drags zerstört wird, räumen wir Listener auf.
        this.removeDragEventListeners();
    }

    public mouseDown() {
        this.fillColor.set('#e0f3ff');
    }

    public mouseUp() {
        this.fillColor.set('white');
    }

    public onPointerDown(event: PointerEvent) {
        this.bringToFront();
        if (!this.dragAndDropEnabled() || this.drag.active) {
            return;
        }
        const node = this.diagramNode();
        if (!node) {
            return;
        }
        const svgEl = this.findSurroundingSvg(<Element | undefined> event.target);
        this.drag.canvasWidth = svgEl?.clientWidth ?? this.drag.canvasWidth;
        this.drag.canvasHeight = svgEl?.clientHeight ?? this.drag.canvasHeight;

        this.drag.active = true;
        this.drag.startMouseX = event.clientX;
        this.drag.startMouseY = event.clientY;
        this.drag.startNodeX = node.x();
        this.drag.startNodeY = node.y();

        this.mouseDown();

        this.drag.moveListener = (e: PointerEvent) => this.onPointerMove(e);
        this.drag.upListener = (e: PointerEvent) => this.onPointerUp(e);
        this.drag.listenerTarget.addEventListener('pointermove', this.drag.moveListener as EventListener, {passive: false} as AddEventListenerOptions);
        this.drag.listenerTarget.addEventListener('pointerup', this.drag.upListener as EventListener, {passive: false} as AddEventListenerOptions);
        this.drag.listenerTarget.addEventListener('pointercancel', this.drag.upListener as EventListener, {passive: false} as AddEventListenerOptions);
        event.preventDefault();
        event.stopPropagation();
    }

    private onPointerMove(event: PointerEvent) {
        if (!this.drag.active) {
            return;
        }
        const node = this.diagramNode();
        if (!node) {
            return;
        }
        const deltaX = event.clientX - this.drag.startMouseX;
        const deltaY = event.clientY - this.drag.startMouseY;
        let newX = this.drag.startNodeX + deltaX;
        let newY = this.drag.startNodeY + deltaY;

        const dim = this.nodeDimensionService.getDimension(node.id)();
        const margins = calculateNodeMargins(this.kind()!, dim);
        newX = this.clamp(newX, CANVAS_PADDING + margins.left, this.drag.canvasWidth - CANVAS_PADDING - margins.right);
        newY = this.clamp(newY, CANVAS_PADDING + margins.top, this.drag.canvasHeight - CANVAS_PADDING - margins.bottom);

        node.setX(newX);
        node.setY(newY);
    }

    private onPointerUp(event: PointerEvent) {
        this.finishDrag();
        event.preventDefault();
        event.stopPropagation();
    }

    private finishDrag() {
        if (!this.drag.active) {
            return;
        }
        this.mouseUp();
        this.drag.active = false;
        this.removeDragEventListeners();
    }

    private removeDragEventListeners() {
        if (this.drag.listenerTarget) {
            if (this.drag.moveListener) {
                this.drag.listenerTarget.removeEventListener('pointermove', this.drag.moveListener as EventListener);
            }
            if (this.drag.upListener) {
                this.drag.listenerTarget.removeEventListener('pointerup', this.drag.upListener as EventListener);
                this.drag.listenerTarget.removeEventListener('pointercancel', this.drag.upListener as EventListener);
            }
        }
        this.drag.moveListener = undefined;
        this.drag.upListener = undefined;
    }

    private clamp(value: number, min: number, max: number) {
        if (min > max) {
            return (min + max) / 2;
        }
        return Math.max(min, Math.min(max, value));
    }

    private findSurroundingSvg(element: Element | undefined) {
        // Fallback auf das erste SVG im Dokument, falls kein übergeordnetes SVG gefunden wird.
        return element?.closest('svg') ?? document.querySelector('svg');
    }

    bringToFront() {
        bringToFront(this.elementRef.nativeElement);
    }

}
