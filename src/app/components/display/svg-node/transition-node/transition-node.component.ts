import {CommonModule} from '@angular/common';
import {afterNextRender, Component, computed, effect, ElementRef, inject, Injector, input, signal, untracked, viewChild} from '@angular/core';
import {DiagramNode} from '../../../../classes/diagram/diagram-node';
import {SvgDefsIdContextDirective} from '../../../../directives/svg-defs-id-context.directive';
import {DisplayService} from '../../../../services/display.service';
import {sanitizeString} from '../../../../services/parsing/parsing-util';
import {InlineEditableLabelComponentBase} from '../shared/inline-edit-base';
import {TRANSITION_HEIGHT, TRANSITION_WIDTH} from '../svg-node';

@Component({
    selector: 'g[SvgTransitionNode]',
    imports: [CommonModule],
    templateUrl: './transition-node.component.html',
    styleUrl: './transition-node.component.scss'
})
export class TransitionNodeComponent extends InlineEditableLabelComponentBase {

    readonly svgDefsIdSuffix = inject(SvgDefsIdContextDirective, {optional: true})?.idSuffix;
    readonly injector = inject(Injector);
    readonly displayService = inject(DisplayService);

    readonly diagramNode = input<DiagramNode>();
    readonly showActivatedState = computed(() => this.displayService.showHints() && this.tokenGameMode());

    readonly rect = computed(() => {
        const node = this.diagramNode();
        if (!node) {
            return undefined;
        }
        return {
            x: node.x() - TRANSITION_WIDTH / 2,
            y: node.y() - TRANSITION_HEIGHT / 2,
            w: TRANSITION_WIDTH,
            h: TRANSITION_HEIGHT
        };
    });

    readonly validationStatus = computed(() => this.diagramNode()?.validity()?.status);

    readonly isActivated = computed(() => this.diagramNode()?.activated() && this.showActivatedState());

    textElement = viewChild<ElementRef<SVGTextElement>>('textEl');
    availableTextWidth = signal(0);
    textNeedsAdjustment = signal(false);

    constructor() {
        super();
        // Reaktiv auf Label- und Größenänderungen reagieren
        effect(() => {
            this.label(); // Abhängigkeit des effect, NICHT ENTFERNEN
            const rectangle = untracked(() => this.rect()); // untracked, weil die Breite sich nicht ändert

            afterNextRender(() => {
                const textEl = this.textElement();
                this.availableTextWidth.set(rectangle ? rectangle.w - 5 : 0); // 5 Einheiten Puffer

                if (!textEl) {
                    this.textNeedsAdjustment.set(false);
                    return;
                }

                const actualLength = textEl.nativeElement.getComputedTextLength();
                this.textNeedsAdjustment.set(actualLength > this.availableTextWidth());
            }, {injector: this.injector});
        });
    }

    protected override getDiagramNodeOrEdge(): DiagramNode | undefined {
        return this.diagramNode();
    }

    protected override getEditBoxSvgCenter(): { x: number; y: number } | undefined {
        const rect = this.rect();
        if (!rect) {
            return undefined;
        }
        return {
            x: rect.x + rect.w / 2,
            y: rect.y + rect.h / 2
        };
    }

    // keine Leerzeichen im Transition-Label erlauben wegen des Transition-Sequenz-Formats
    protected override sanitizeEditValue(raw: string): string {
        return sanitizeString(raw.replace(/\s+/g, ''));
    }

}
