import {CommonModule} from '@angular/common';
import {Component, computed, effect, inject, input, signal} from '@angular/core';
import {ReachabilityNode} from '../../../../classes/reachability/reachability-node';
import {SvgDefsIdContextDirective} from '../../../../directives/svg-defs-id-context.directive';
import {DisplayService} from '../../../../services/display.service';
import {NodeDimensionService} from '../../../../services/node-dimension.service';
import {InlineEditableLabelComponentBase} from '../shared/inline-edit-base';

export const STATE_NODE_HEIGHT = 40;

@Component({
    selector: 'g[SvgStateNode]',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './state-node.component.html',
    styleUrl: './state-node.component.scss'
})
export class StateNodeComponent extends InlineEditableLabelComponentBase<ReachabilityNode> {

    readonly CHAR_WIDTH = 9.5; // Später mit einem String Pixel Lenght Servive ablösen
    readonly HORIZONTAL_PADDING = 24;
    readonly MIN_WIDTH = 50;
    private dimService = inject(NodeDimensionService);

    stateNodeEditBoxHeight = this.EDIT_BOX_HEIGHT + 4;
    stateNodeEditBoxWidth = this.EDIT_BOX_WIDTH * 1.5;

    readonly svgDefsIdSuffix = inject(SvgDefsIdContextDirective, {optional: true})?.idSuffix;
    protected displayService = inject(DisplayService);

    readonly diagramNode = input<ReachabilityNode>();
    readonly placeIds = input<string[]>([]);

    readonly hovered = signal(false);

    readonly showApplyMarkingButton = computed(() => {
        return this.displayService.showHints() && (this.validationStatus() === 'valid' || this.validationStatus() === 'partly-valid');
    });

    readonly position = computed(() => {
        const node = this.diagramNode();
        return node ? { x: node.x(), y: node.y() } : { x: 0, y: 0 };
    });

    readonly nodeWidth = computed(() => {
        const label = this.label();
        const labelWidth = label.length * this.CHAR_WIDTH;
        return Math.max(this.MIN_WIDTH, labelWidth + this.HORIZONTAL_PADDING);
    });

    readonly rect = computed(() => {
        const {x, y} = this.position();
        const w = this.nodeWidth();
        const h = STATE_NODE_HEIGHT;
        return {x: x - w / 2, y: y - h / 2, w, h};
    });

    override readonly label = computed(() => {
        this.isEditing();
        const node = this.diagramNode();
        return node?.label() ?? '';
    });

    readonly labelParts = computed(() => {
        const node = this.diagramNode();
        if (!node) {
            return [];
        }
        const label = this.label();
        const cleanLabel = label.replace(/[()]/g, '');
        const parts = cleanLabel.split(',');

        const marking = node.marking();
        const markingKeys = Object.keys(marking);
        const validityMap = node.markingValidity();

        return parts.map((part, index) => {
            const key = markingKeys[index];
            const validity = key ? validityMap[key] : undefined;
            return {
                text: part.trim(),
                validity: validity ?? node.validity()
            };
        });
    });

    readonly validationStatus = computed(() => this.diagramNode()?.validity()?.status);

    constructor() {
        super();
        effect(() => {
            const node = this.diagramNode();
            if (node) {
                this.dimService.updateDimension(node.id, this.nodeWidth(), STATE_NODE_HEIGHT);
            }
        });
    }

    protected getDiagramNodeOrEdge(): ReachabilityNode | undefined {
        return this.diagramNode();
    }

    protected override getEditBoxSvgCenter(): { x: number; y: number } | undefined {
        const pos = this.position();
        return { x: pos.x, y: pos.y };
    }

    protected override getEditBoxDimensions(): { width: number; height: number } {
        return { width: this.stateNodeEditBoxWidth, height: this.stateNodeEditBoxHeight };
    }

    protected override getEditPlaceholder(): string | undefined {
        return 'e.g. 0, 1, w, 2';
    }

    override onLabelDblClick(event: Event) {
        super.onLabelDblClick(event);
        this.editValue.set(this.label().replace(/[()]/g, '').replace(/,/g, ', ')); // Klammern entfernen für die Bearbeitung
    }

    // nur Ziffern, w (Omega), Komma und Leerzeichen erlauben
    override sanitizeEditValue(raw: string): string {
        return raw.replace(/[^0-9w, ]+/g, '');
    }

    /**
     * Normalisiert ein StateNode-Label in das kanonische Format (ohne Klammern, ohne Leerzeichen nach Kommas).
     * z.B. "0, 1, w, 2" -> "0,1,w,2" oder "(0,1,w,2)" -> "0,1,w,2"
     */
    protected override normalizeLabel(label: string): string {
        const cleaned = label.replace(/[()]/g, '').trim();
        if (!/^[0-9w, ]*$/.test(cleaned)) {
            return cleaned;
        }
        return cleaned
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => (s === 'w' ? 'w' : String(Number(s))))
            .join(',');
    }

    override commitEdit() {
        const normalizedLabel = this.normalizeLabel(this.editValue());
        this.editValue.set(normalizedLabel);

        super.commitEdit();

        const node = this.diagramNode();
        const places = this.placeIds();
        if (node && places.length > 0) {
            node.tryUpdateMarkingFromLabel(places);
        }
    }

    showNodeMarkingInPreview(event: MouseEvent) {
        if (this.readonlyMode()) {
            return;
        }
        event.stopPropagation();

        const node = this.diagramNode();
        if (node) {
            node.setActivated(true);
            this.diagramNodes().forEach(n => {
                if (n !== node) {
                    (n as ReachabilityNode).setActivated(false);
                }
            });
            this.displayService.updateReachabilityPreviewMarking(node.marking());
        }
    }

    protected override getDuplicateNodeErrorMessage() {
        return 'Node with identical state already exists';
    }

    // eslint-disable-next-line @typescript-eslint/member-ordering
    readonly STATE_NODE_HEIGHT = STATE_NODE_HEIGHT;

}
