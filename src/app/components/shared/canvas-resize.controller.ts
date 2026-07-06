import {signal} from '@angular/core';
import {CANVAS_PADDING} from '../display/svg-node/svg-node';

export class CanvasResizeController {

    readonly canvasHeight = signal<number>(570);
    readonly enableSmoothHeight = signal<boolean>(false);
    private readonly minHeight: number;

    constructor(minHeight: number = 570) {
        this.minHeight = minHeight;
    }

    adjustHeight(contentMaxY: number, padding: number = CANVAS_PADDING + 6) {
        const newHeight = Math.max(this.minHeight, contentMaxY + padding);
        if (newHeight !== this.canvasHeight()) {
            this.canvasHeight.set(newHeight);
        }

        if (!this.enableSmoothHeight()) { // nach dem initialen Setzen nur noch smooth ändern
            setTimeout(() => this.enableSmoothHeight.set(true), 100);
        }
    }

}
