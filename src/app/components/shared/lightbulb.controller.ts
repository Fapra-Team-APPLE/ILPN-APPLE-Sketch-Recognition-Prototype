import {IDiagramEdge, IDiagramNode} from '../../classes/diagram/diagram-types';
import {HintOverlayPayload} from '../../services/overlay.service';
import {hitTest, isPointNearSegment} from './canvas-helper';

export interface LightbulbConfig<N extends IDiagramNode, E extends IDiagramEdge> {
    getSelectedTool(): string | undefined | null;

    getNodes(): readonly N[];

    getEdges(): readonly E[];

    findSvgForEventTarget(target: EventTarget | null): SVGSVGElement | null;

    openOverlay(p: HintOverlayPayload): void;

    getNodeDimension(id: string): {w: number, h: number};

}

/**
 * Wiederverwendbarer Controller für Lightbulb-Verhalten (Auf (partly) invalid Element klicken, um Overlay mit Hinweisen anzuzeigen).
 */
export class LightbulbController<N extends IDiagramNode, E extends IDiagramEdge> {

    constructor(private readonly config: LightbulbConfig<N, E>) {
    }

    onCanvasMouseEventLightbulb(event: MouseEvent) {
        if (this.config.getSelectedTool() !== 'lightbulb') {
            return;
        }
        // Das SVG finden (je nach Aufbau ist currentTarget evtl. nicht direkt SVG)
        const svg = this.config.findSvgForEventTarget(event.currentTarget);
        if (!svg) {
            return;
        }
        this.openHintAt(svg, event.clientX, event.clientY);

        event.preventDefault();
    }

    private openHintAt(svg: SVGSVGElement, clientX: number, clientY: number) {
        const nodes = this.config.getNodes();
        const edges = this.config.getEdges();
        if (!nodes || !edges) {
            return;
        }

        const nodeToShowHint = nodes.find(node => hitTest(svg, node, clientX, clientY, this.config?.getNodeDimension?.(node.id)));
        if (nodeToShowHint) {
            const nodeValidity = nodeToShowHint?.validity();
            if (nodeValidity && nodeValidity.status !== 'valid') {
                this.config.openOverlay({x: clientX, y: clientY, node: nodeToShowHint});
            }
            return;
        }

        const edgeToShowHint = edges.find(edge => isPointNearSegment(svg, edge, clientX, clientY));
        if (edgeToShowHint) {
            const edgeValidity = edgeToShowHint.validity();
            if (edgeValidity && (edgeValidity.status !== 'valid')) {
                this.config.openOverlay({x: clientX, y: clientY, edge: edgeToShowHint});
            }
            return;
        }
    }

}
