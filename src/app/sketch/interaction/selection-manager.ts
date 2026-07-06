import {signal} from '@angular/core';
import {IDiagramNode} from '../../classes/diagram/diagram-types';

/**
 * Verwaltet den Selection-State eines einzelnen Knotens auf dem Canvas
 *
 * Selection-Modell (zweistufig):
 * 1. Tap auf nicht ausgewählten Knoten -> selektieren
 * 2. Tap auf bereits ausgewählten Knoten -> Label-Editor öffnen
 * 3. Tap auf leeren Canvas -> deselektieren
 */
export class SelectionManager {

    private readonly _selectedNodeId = signal<string | null>(null);
    readonly selectedNodeId = this._selectedNodeId.asReadonly();

    tapOnNode(node: IDiagramNode): 'selected' | 'label' {
        const currentId = this._selectedNodeId();

        if (currentId === node.id) {
            // Bereits selektiert -> Label-Editor auslösen
            return 'label';
        }

        this._selectedNodeId.set(node.id);
        return 'selected';
    }

    tapOnCanvas(): void {
        this._selectedNodeId.set(null);
    }

    isSelected(nodeId: string): boolean {
        return this._selectedNodeId() === nodeId;
    }

    hasSelection(): boolean {
        return this._selectedNodeId() !== null;
    }

    getSelectedId(): string | null {
        return this._selectedNodeId();
    }

    clear(): void {
        this._selectedNodeId.set(null);
    }

}
