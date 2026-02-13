import {computed, Directive, ElementRef, input, output, signal, viewChild} from '@angular/core';
import type {AbstractDiagramNode} from '../../../../classes/diagram/abstract-diagram-node';
import {DiagramEdge} from '../../../../classes/diagram/diagram-edge';
import {IDiagramNode} from '../../../../classes/diagram/diagram-types';
import {EDIT_BOX_HEIGHT, EDIT_BOX_WIDTH} from '../svg-node';

/**
 * Gemeinsame Basisklasse für Inline-Label-Editing in SVG-Knoten.
 * Erwartet, dass die abgeleitete Komponente:
 * - `getDiagramNode()` überschreibt
 * - im Template ein <input #labelInput> im Edit-Zustand bereitstellt
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

    // Referenz auf das Eingabefeld im foreignObject
    editInputRef = viewChild<ElementRef<HTMLInputElement>>('labelInput');

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


    // Abgeleitete Klassen müssen diese Methode überschreiben, um die aktuelle DiagramNode oder DiagramEdge oder bereitzustellen
    protected abstract getDiagramNodeOrEdge(): NodeOrEdgeType | undefined;

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

        // Fokus setzen, sobald das Input gerendert ist
        setTimeout(() => {
            const inputEl = this.editInputRef()?.nativeElement;
            if (inputEl) {
                inputEl.focus();
            }
        });
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

    onInputChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const raw = target.value ?? '';
        const sanitized = this.sanitizeEditValue(raw);

        if (sanitized !== raw) {
            target.value = sanitized; // Auto-Korrektur
        }
        this.editValue.set(sanitized);
    }

    onInputBlur(_event: FocusEvent) {
        if (!this.isEditing()) {
            return;
        }
        const newLabel = this.editValue().trim();
        // Leer oder unverändert = ok -> commitEdit:-> dann setLabel(undefined) bzw. unverändert
        if (!this.canCommitLabel(newLabel)) {
            this.cancelEdit(); // wie ESC
            return;
        }

        this.commitEdit();
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
    }

    cancelEdit() {
        this.isEditing.set(false);
    }


    // eslint-disable-next-line @typescript-eslint/member-ordering
    protected readonly EDIT_BOX_WIDTH = EDIT_BOX_WIDTH; // Für Zugriff aus Templates in abgeleiteten Klassen
    // eslint-disable-next-line @typescript-eslint/member-ordering
    protected readonly EDIT_BOX_HEIGHT = EDIT_BOX_HEIGHT; // Für Zugriff aus Templates in abgeleiteten Klassen

}
