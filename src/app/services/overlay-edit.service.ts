import {Injectable, signal, untracked} from '@angular/core';

/**
 * Koordiniert das Overlay-Eingabefeld für Label-Editing
 *
 * Das Input wird außerhalb des SVG im normalen HTML-DOM gerendert, damit z. B. die Samsung Stift-Handschrifteingabe das Feld erkennt
 */

export interface OverlayEditState {
    /** Position relativ zum Display-Host in px */
    left: number;
    top: number;
    width: number;
    height: number;
    value: string;
    placeholder?: string;

    onInput: (value: string) => string;
    onCommit: () => void;
    onCancel: () => void;
    isInvalid: () => boolean;
    tooltipText: () => string | null;
}

export interface OverlayLabelInputInterface {
    focusSynchronously(value: string): void;
}

@Injectable()
export class OverlayEditService {

    readonly activeEdit = signal<OverlayEditState | null>(null);
    private activeComponent?: OverlayLabelInputInterface;

    register(component: OverlayLabelInputInterface) {
        this.activeComponent = component;
    }

    unregister(component: OverlayLabelInputInterface) {
        if (this.activeComponent === component) {
            this.activeComponent = undefined;
        }
    }

    open(state: OverlayEditState): void {
        const current = this.activeEdit();
        if (current) {
            if (current.isInvalid()) {
                current.onCancel();
            } else {
                current.onCommit();
            }
        }

        this.activeEdit.set(state);
        if (this.activeComponent) {
            this.activeComponent.focusSynchronously(state.value);
        }
    }

    close(): void {
        this.activeEdit.set(null);
    }

    updatePosition(left: number, top: number): void {
        const current = untracked(() => this.activeEdit());
        if (current) {
            this.activeEdit.set({
                ...current,
                left,
                top
            });
        }
    }

}
