import {IDiagramEdge, IDiagramNode} from '../../classes/diagram/diagram-types';
import {hitTest, isPointNearSegment} from './canvas-helper';

export interface EraserConfig<N extends IDiagramNode, E extends IDiagramEdge> {
    getSelectedTool(): string | undefined | null;
    getNodes(): readonly N[];
    getEdges(): readonly E[];
    setDiagram(nodes: readonly N[], edges: readonly E[]): void;
    findSvgForEventTarget(target: EventTarget | null): SVGSVGElement | null;
    getNodeDimension(id: string): { w: number, h: number };
}

/**
 * Wiederverwendbarer Controller für Radiergummi-Verhalten (Klicken/Draggen zum Löschen von Knoten/Kanten).
 */
export class EraserController<N extends IDiagramNode, E extends IDiagramEdge> {

    private state: {
        active: boolean;
        svg: SVGSVGElement | null;
        moveListener?: (e: PointerEvent) => void;
        upListener?: (e: PointerEvent) => void;
    } = {active: false, svg: null};

    constructor(private readonly config: EraserConfig<N, E>) {
    }

    onCanvasPointerDown(event: PointerEvent) {
        if (this.config.getSelectedTool() !== 'eraser') {
            return;
        }
        this.state.svg = this.config.findSvgForEventTarget(event.currentTarget);
        if (!this.state.svg) {
            return;
        }
        this.state.active = true;
        this.eraseByEvent(event);

        this.state.moveListener = (e: PointerEvent) => {
            if (!this.state.active) {
                return;
            }
            if (this.config.getSelectedTool() !== 'eraser') {
                // Toolwechsel während Drag => abbrechen
                this.onPointerUp(e);
                return;
            }
            this.eraseByEvent(e);
            e.preventDefault();
        };
        this.state.upListener = (e: PointerEvent) => this.onPointerUp(e);
        window.addEventListener('pointermove', this.state.moveListener);
        window.addEventListener('pointerup', this.state.upListener, {once: true});
        window.addEventListener('pointercancel', this.state.upListener, {once: true});

        event.preventDefault();
    }

    destroy() {
        this.state.active = false;
        this.state.svg = null;
        this.cleanupListeners();
    }

    private onPointerUp(_event: PointerEvent) {
        this.state.active = false;
        this.cleanupListeners();
    }

    private cleanupListeners() {
        try {
            if (this.state.moveListener) {
                window.removeEventListener('pointermove', this.state.moveListener);
            }
            if (this.state.upListener) {
                window.removeEventListener('pointerup', this.state.upListener as EventListener);
                window.removeEventListener('pointercancel', this.state.upListener as EventListener);
            }
        } catch {
            // ignore
        } finally {
            this.state.moveListener = undefined;
            this.state.upListener = undefined;
        }
    }

    private eraseByEvent(event: PointerEvent) {
        const svg = this.state.svg;
        if (!svg) {
            return;
        }
        this.eraseAt(svg, event.clientX, event.clientY);
    }

    private eraseAt(svg: SVGSVGElement, clientX: number, clientY: number) {
        const nodes = this.config.getNodes();
        const edges = this.config.getEdges();
        if (!nodes || !edges) {
            return;
        }

        const nodeToDelete = nodes.find(node => hitTest(svg, node, clientX, clientY, this.config?.getNodeDimension?.(node.id)));
        if (nodeToDelete) {
            const remainingNodes = nodes.filter(n => n !== nodeToDelete);
            const remainingEdges = edges.filter(e => e.source !== nodeToDelete && e.target !== nodeToDelete);
            this.config.setDiagram(remainingNodes, remainingEdges);
            return;
        }

        const hitEdge = edges.find(edge => isPointNearSegment(svg, edge, clientX, clientY));
        if (hitEdge) {
            const remainingEdges = edges.filter(e => e !== hitEdge);
            this.config.setDiagram(nodes, remainingEdges);
        }
    }

}
