import {ChangeDetectorRef, Component, ElementRef, inject, OnDestroy, viewChild} from '@angular/core';
import {MatTooltip} from '@angular/material/tooltip';
import {OverlayEditService, OverlayEditState, OverlayLabelInputInterface} from '../../../services/overlay-edit.service';

/**
 * Einzelnes, absolut positioniertes Overlay-Input für Label-Editing
 *
 * Wird außerhalb des SVG im normalen HTML-DOM gerendert, damit z. B. die Samsung Stift-Handschrifteingabe das Feld erkennt
 *
 * Muss als Child einer Komponente verwendet werden, die:
 * - `OverlayEditService` in ihren `providers` bereitstellt
 * - `:host { position: relative; }` gesetzt hat
 */
@Component({
    selector: 'app-overlay-label-input',
    imports: [MatTooltip],
    template: `
        @if (overlayEditService.activeEdit(); as edit) {
            <input #overlayInput
                   type="text"
                   class="overlay-label-input"
                   [value]="edit.value"
                   [placeholder]="edit.placeholder ?? ''"
                   [class.invalid]="edit.isInvalid()"
                   [matTooltip]="edit.tooltipText() ?? ''"
                   [matTooltipDisabled]="!edit.isInvalid()"
                   matTooltipPosition="above"
                   [style.left.px]="edit.left"
                   [style.top.px]="edit.top"
                   [style.width.px]="edit.width"
                   [style.height.px]="edit.height"
                   (input)="onInput($event)"
                   (keydown.enter)="edit.onCommit()"
                   (keydown.escape)="edit.onCancel()"
                   (blur)="onBlur(edit)"
                   (pointerdown)="$event.stopPropagation(); $any($event.target).focus()"
                   (pointerup)="$event.stopPropagation()"
                   (touchstart)="$event.stopPropagation(); $any($event.target).focus()" />
        }
    `,
    styles: [`
        .overlay-label-input {
            position: absolute;
            z-index: 10;
            box-sizing: border-box;
            padding: 2px 8px;
            text-align: center;
            line-height: normal;
            margin: 0;
            font-size: 15px;
            border: 1px solid #ccc;
            border-radius: 4px;
            outline: none;
            background: white;

            &:focus {
                border-color: #2196F3;
                box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.2);
            }

            &.invalid {
                outline: none;
                border: 2px solid var(--apple-error) !important;
            }
        }
    `],
    // Kein eigener DOM-Wrapper, damit position: absolute relativ zum Host-Container der Elternkomponente greift
    host: {
        'style': 'display: contents;'
    }
})
export class OverlayLabelInputComponent implements OverlayLabelInputInterface, OnDestroy {

    protected readonly overlayEditService = inject(OverlayEditService);
    private readonly overlayInputRef = viewChild<ElementRef<HTMLInputElement>>('overlayInput');
    private readonly cd = inject(ChangeDetectorRef);

    // Flag, um zu verhindern, dass das blur-Event sofort nach dem focus-Event ausgelöst wird
    private justFocused = false;

    constructor() {
        this.overlayEditService.register(this);
    }

    ngOnDestroy(): void {
        this.overlayEditService.unregister(this);
    }

    focusSynchronously(value: string): void {
        // Input direkt im selben synchronen Ausführungsblock fokussieren, da iOS/Safari das Fokussieren sonst blockiert
        this.cd.detectChanges();
        const inputEl = this.overlayInputRef()?.nativeElement;
        if (inputEl) {
            inputEl.value = value;
            this.justFocused = true;
            inputEl.focus();
            // Flag nach kurzer Zeit zurücksetzen
            setTimeout(() => {
                this.justFocused = false;
            }, 50);
        }
    }

    onInput(event: Event): void {
        const target = event.target as HTMLInputElement;
        const edit = this.overlayEditService.activeEdit();
        if (edit) {
            const sanitized = edit.onInput(target.value);
            if (target.value !== sanitized) {
                target.value = sanitized;
            }
        }
    }

    onBlur(edit: OverlayEditState): void {
        if (this.justFocused) { // Verhindern, dass das blur-Event sofort nach dem focus-Event ausgelöst wird
            const inputEl = this.overlayInputRef()?.nativeElement;
            // Focus zurücksetzen
            if (inputEl) {
                inputEl.focus();
            }
            return;
        }

        const current = this.overlayEditService.activeEdit();
        if (current === edit) {
            if (edit.isInvalid()) {
                edit.onCancel();
            } else {
                edit.onCommit();
            }
        }
    }

}
