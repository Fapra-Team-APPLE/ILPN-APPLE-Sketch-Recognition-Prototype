import {StrokePoint, distance} from './recognizers/recognition-types';

/**
 * Sammelt rohe Pointer Inputs zu einem Stroke (Sequenz von StrokePoints)
 */
export class StrokeCollector {

    // Minimale Distanz (px) zwischen aufeinanderfolgenden Punkten, um einen neuen zu akzeptieren (gegen Jitter)
    private readonly minDistance: number;

    private _points: StrokePoint[] = [];
    private _active = false;

    constructor(minDistance = 2) {
        this.minDistance = minDistance;
    }

    // Ob die Stroke-Aufzeichnung gerade aktiv ist
    get active(): boolean {
        return this._active;
    }

    // Bereits gesammelte Punkte (live)
    get points(): readonly StrokePoint[] {
        return this._points;
    }

    beginStroke(point: StrokePoint): void {
        this._points = [point];
        this._active = true;
    }

    addPoint(point: StrokePoint): void {
        if (!this._active) {
            return;
        }
        const last = this._points.at(-1);
        if (last && distance(last, point) < this.minDistance) {
            return;
        }
        this._points.push(point);
    }

    endStroke(): StrokePoint[] {
        const result = this._points;
        this.reset();
        return result;
    }

    reset(): void {
        this._active = false;
        this._points = [];
    }

}
