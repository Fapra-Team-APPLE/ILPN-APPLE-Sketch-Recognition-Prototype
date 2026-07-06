import {ChangeDetectorRef, computed, Directive, effect, ElementRef, inject, input, output, signal, untracked} from '@angular/core';
import type {AbstractDiagramNode} from '../../../../classes/diagram/abstract-diagram-node';
import {DiagramEdge} from '../../../../classes/diagram/diagram-edge';
import {IDiagramNode} from '../../../../classes/diagram/diagram-types';
import {OverlayEditService} from '../../../../services/overlay-edit.service';
import {EDIT_BOX_HEIGHT, EDIT_BOX_WIDTH} from '../svg-node';

/**
 * Gemeinsame Basisklasse für Inline-Label-Editing in SVG-Knoten.
 * Erwartet, dass die abgeleitete Komponente:
 * - `getDiagramNodeOrEdge()` überschreibt
 * - `getEditBoxSvgCenter()` überschreibt, um die SVG-Koordinaten des Edit-Bereichs zu liefern
 */
type CommitBlockReason = 'label_conflict' | null;

@Directive()
export abstract class InlineEditableLabelComponentBase<NodeOrEdgeType extends AbstractDiagramNode | DiagramEdge = AbstractDiagramNode> {

    readonly diagramNodes = input<IDiagramNode[]>([]);
    readonly enforceUniqueLabels = input<boolean>(false);

    readonly readonlyMode = input<boolean>(false);
    readonly tokenGameMode = input<boolean>(false);
    readonly requestFront = output<void>();


    isEditing = signal(false);
    editValue = signal('');

    protected readonly cd = inject(ChangeDetectorRef);
    protected readonly overlayEditService = inject(OverlayEditService);
    private readonly hostElementRef = inject(ElementRef);

    readonly label = computed(() => {
        this.isEditing(); // Abhängig von isEditing, damit der Wechsel re-render triggert
        const nodeOrEdge = this.getDiagramNodeOrEdge();
        const nodeOrEdgeId = nodeOrEdge && 'id' in nodeOrEdge ? nodeOrEdge.id : null;
        return nodeOrEdge?.label?.() ?? nodeOrEdgeId ?? '';
    });

    readonly editInvalid = computed(() => {
        return this.getCommitBlockReason(this.editValue().trim()) !== null;
    });

    readonly invalidLabelTooltip = computed<string | null>(() => {
        if (!this.isEditing()) {
            return null;
        }
        const value = this.editValue().trim();
        const reason = this.getCommitBlockReason(value);
        if (!reason) {
            return null;
        }
        return this.getDuplicateNodeErrorMessage();
    });


    constructor() {
        // Aktualisiere die absolute Position des Eingabefeldes reaktiv, wenn sich die Knoten-/Kantenkoordinaten verändern
        effect(() => {
            if (!this.isEditing()) {
                return;
            }

            const center = this.getEditBoxSvgCenter();
            if (!center) {
                return;
            }

            const editBoxDimensions = this.getEditBoxDimensions();
            const overlayPosition = this.calculateOverlayPosition(center, editBoxDimensions);
            if (!overlayPosition) {
                return;
            }

            untracked(() => {
                this.overlayEditService.updatePosition(overlayPosition.left, overlayPosition.top);
            });
        });
    }

    // Abgeleitete Klassen müssen diese Methode überschreiben, um die aktuelle DiagramNode oder DiagramEdge oder bereitzustellen
    protected abstract getDiagramNodeOrEdge(): NodeOrEdgeType | undefined;

    /**
     * Liefert die SVG-Koordinaten (x, y) der Mitte des Edit-Bereichs
     */
    protected abstract getEditBoxSvgCenter(): { x: number; y: number } | undefined;

    /**
     * Liefert die Breite und Höhe des Edit-Bereichs. Kann überschrieben werden (z.B. für StateNode)
     */
    protected getEditBoxDimensions(): { width: number; height: number } {
        return {width: EDIT_BOX_WIDTH, height: EDIT_BOX_HEIGHT};
    }

    /**
     * Optionaler Placeholder-Text für das Edit-Feld
     */
    protected getEditPlaceholder(): string | undefined {
        return undefined;
    }

    onKeydownEnter(event: Event) {
        event.preventDefault();
        this.commitEdit();
    }

    onKeydownEscape(event: Event) {
        event.preventDefault();
        this.cancelEdit();
    }

    onLabelDblClick(event: Event) {
        if (this.readonlyMode() || this.tokenGameMode()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.startEditing();
    }

    public startEditing(editValue: string = this.label()) {
        this.editValue.set(editValue);
        this.isEditing.set(true);
        this.requestFront?.emit?.();

        // Change detection synchron starten, damit SVG-Elemente korrekt positioniert sind
        this.cd.detectChanges();

        this.openOverlayInput();
    }

    protected getDuplicateNodeErrorMessage() {
        return 'Node with identical Label already exists';
    }

    protected canCommitLabel(newLabel: string): boolean {
        return this.getCommitBlockReason(newLabel) === null;
    }

    /**
     * Normalisiert ein Label für den Vergleich. Kann von Subklassen überschrieben werden.
     */
    protected normalizeLabel(label: string): string {
        return label.trim();
    }

    /**
     * Liefert den Grund, warum ein Commit blockiert wird (oder null, wenn ok).
     * - label_conflict: newLabel entspricht einem existierenden effectiveLabel (anderer Node)
     */
    protected getCommitBlockReason(newLabel: string): CommitBlockReason {
        if (!this.enforceUniqueLabels()) {
            return null;
        }

        const node = this.getDiagramNodeOrEdge();
        if (!node) {
            return 'label_conflict';
        }

        const normalizedNew = this.normalizeLabel(newLabel);

        // Label-Feld leer oder unverändert
        if (!normalizedNew || normalizedNew === this.normalizeLabel(node.label() ?? '')) {
            return null;
        }

        const nodes = this.diagramNodes();

        const hitsExistingEffectiveLabel = nodes.some(other => other !== node && this.normalizeLabel(other.effectiveLabel()) === normalizedNew);
        if (hitsExistingEffectiveLabel) {
            return 'label_conflict';
        }

        return null;
    }

    protected sanitizeEditValue(raw: string): string {
        return raw;
    }

    private openOverlayInput(): void {
        const center = this.getEditBoxSvgCenter();
        if (!center) {
            return;
        }

        const editBoxDimensions = this.getEditBoxDimensions();
        const overlayPosition = this.calculateOverlayPosition(center, editBoxDimensions);
        if (!overlayPosition) {
            return;
        }

        this.overlayEditService.open({
            left: overlayPosition.left,
            top: overlayPosition.top,
            width: editBoxDimensions.width,
            height: editBoxDimensions.height,
            value: this.editValue(),
            placeholder: this.getEditPlaceholder(),
            onInput: (value: string) => { return this.handleOverlayInput(value); },
            onCommit: () => this.commitEdit(),
            onCancel: () => this.cancelEdit(),
            isInvalid: () => this.editInvalid(),
            tooltipText: () => this.invalidLabelTooltip()
        });
    }


    /**
     * Berechnet die absolute CSS-Position des Eingabefeldes relativ zum displayHost
     */
    private calculateOverlayPosition(center: { x: number; y: number }, dims: { width: number; height: number }): { left: number; top: number } | undefined {
        const hostEl = this.hostElementRef.nativeElement as Element;
        const svgEl = hostEl.closest('svg');
        if (!svgEl) {
            return undefined;
        }

        const displayHost = svgEl.parentElement;
        if (!displayHost) {
            return undefined;
        }

        const svgRect = svgEl.getBoundingClientRect();
        const hostRect = displayHost.getBoundingClientRect();

        const svgStyle = window.getComputedStyle(svgEl);
        const borderLeft = parseFloat(svgStyle.borderLeftWidth) || 0;
        const borderTop = parseFloat(svgStyle.borderTopWidth) || 0;

        const left = (svgRect.left - hostRect.left) + borderLeft + center.x - dims.width / 2;
        const top = (svgRect.top - hostRect.top) + borderTop + center.y - dims.height / 2;

        return {left, top};
    }

    /**
     * Verarbeitet Input-Änderungen vom Overlay-Input. Gibt den sanitized Wert zurück
     */
    private handleOverlayInput(value: string): string {
        const sanitized = this.sanitizeEditValue(value);
        this.editValue.set(sanitized);
        return sanitized;
    }

    commitEdit() {
        const nodeOrEdge = this.getDiagramNodeOrEdge();
        if (!nodeOrEdge || !this.isEditing()) {
            this.cancelEdit();
            return;
        }

        const newLabel = this.editValue().trim();
        if (!this.canCommitLabel(newLabel)) {
            return;
        }
        nodeOrEdge.setLabel(newLabel.length ? newLabel : undefined);
        this.isEditing.set(false);
        this.overlayEditService.close();
    }

    cancelEdit() {
        this.isEditing.set(false);
        this.overlayEditService.close();
    }


    // eslint-disable-next-line @typescript-eslint/member-ordering
    protected readonly EDIT_BOX_WIDTH = EDIT_BOX_WIDTH; // Für Zugriff aus Templates in abgeleiteten Klassen
    // eslint-disable-next-line @typescript-eslint/member-ordering
    protected readonly EDIT_BOX_HEIGHT = EDIT_BOX_HEIGHT; // Für Zugriff aus Templates in abgeleiteten Klassen

}
