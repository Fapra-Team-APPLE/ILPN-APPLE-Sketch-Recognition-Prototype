import {CommonModule} from '@angular/common';
import {Component, computed, inject, input, signal} from '@angular/core';
import {DiagramNode} from '../../../../classes/diagram/diagram-node';
import {SvgDefsIdContextDirective} from '../../../../directives/svg-defs-id-context.directive';
import {sanitizeString} from '../../../../services/parsing/parsing-util';
import {InlineEditableLabelComponentBase} from '../shared/inline-edit-base';
import {PLACE_RADIUS} from '../svg-node';

@Component({
    selector: 'g[SvgPlaceNode]',
    imports: [CommonModule],
    templateUrl: './place-node.component.html',
    styleUrl: './place-node.component.scss'
})
export class PlaceNodeComponent extends InlineEditableLabelComponentBase {

    readonly svgDefsIdSuffix = inject(SvgDefsIdContextDirective, {optional: true})?.idSuffix;

    readonly diagramNode = input<DiagramNode>();
    readonly allowTokenCountModification = input<boolean>(false);
    readonly hovered = signal(false);

    readonly circle = computed(() => {
        const node = this.diagramNode();
        if (!node) {
            return undefined;
        }
        return {cx: node.x(), cy: node.y(), r: PLACE_RADIUS};
    });

    readonly tokenDots = computed(() => {
        const count = this.diagramNode()?.tokenCount ?? 0;
        const circle = this.circle();
        if (!circle || count <= 0 || count > 3) {
            return [];
        }
        const cx = circle.cx;
        const cy = circle.cy;
        const dist = 7;

        if (count === 1) {
            return [{cx, cy}];
        } else if (count === 2) {
            return [
                {cx: cx - dist, cy},
                {cx: cx + dist, cy}
            ];
        } else if (count === 3) {
            return [
                {cx, cy: cy - dist},
                {cx: cx - dist, cy: cy + dist},
                {cx: cx + dist, cy: cy + dist}
            ];
        }
        return [];
    });

    readonly tokenText = computed(() => {
        const tokenCount = this.diagramNode()?.tokenCount ?? 0;
        return tokenCount > 3 ? String(tokenCount) : '';
    });

    readonly tokenCount = computed(() => this.diagramNode()?.tokenCount ?? 0);

    /**
     * zeigt nur im hover Zustand die Plus/Minus-Buttons
     */
    readonly showTokenControls = computed(() =>
        !this.readonlyMode() && this.allowTokenCountModification() && this.hovered() && !this.isEditing());

    readonly validationStatus = computed(() => this.diagramNode()?.validity()?.status);

    incrementTokenCount(): void {
        if (!this.allowTokenCountModification()) {
            return;
        }
        this.diagramNode()?.incrementTokenCount();
    }

    decrementTokenCount(): void {
        const node = this.diagramNode();
        if (!this.allowTokenCountModification() || !node) {
            return;
        }
        if (node.tokenCount > 0) {
            node.decrementTokenCount();
        }
    }

    protected override getDiagramNodeOrEdge(): DiagramNode | undefined {
        return this.diagramNode();
    }

    override getEditBoxSvgCenter(): { x: number; y: number } | undefined {
        const circle = this.circle();
        if (!circle) {
            return undefined;
        }
        return {
            x: circle.cx,
            y: circle.cy + circle.r + 11
        };
    }

    protected override sanitizeEditValue(raw: string): string {
        return sanitizeString(raw);
    }

}
