import {StrokePoint, distance, pathLength} from '../recognizers/recognition-types';

/**
 * Klassifiziert einen abgeschlossenen Stroke entweder als "Tap" (kurze, minimale Bewegung) oder als "Stroke" (Zeichengeste)
 *
 * Ein Tap ist definiert durch:
 * - Dauer unter MAX_TAP_DURATION ms
 * - Gesamtverschiebung unter MAX_TAP_DISTANCE px
 * - Gesamtpfadlänge unter MAX_TAP_PATH_LENGTH px
 */
export class TapDetector {

    private readonly maxTapDuration: number;
    private readonly maxTapDistance: number;
    private readonly maxTapPathLength: number;

    constructor(maxTapDuration = 250, maxTapDistance = 10, maxTapPathLength = 10) {
        this.maxTapDuration = maxTapDuration;
        this.maxTapDistance = maxTapDistance;
        this.maxTapPathLength = maxTapPathLength;
    }

    classify(points: StrokePoint[]): 'tap' | 'stroke' {
        if (points.length === 0) {
            return 'tap';
        }

        const first = points[0];
        const last = points[points.length - 1];

        const duration = last.timestamp - first.timestamp;
        if (duration > this.maxTapDuration) {
            return 'stroke';
        }

        let maxDisplacement = 0;
        for (const point of points) {
            const d = distance(first, point);
            if (d > maxDisplacement) {
                maxDisplacement = d;
            }
        }

        const isTapDisplacement = maxDisplacement <= this.maxTapDistance;
        const isTapPathLength = pathLength(points) <= this.maxTapPathLength;

        return (isTapDisplacement && isTapPathLength) ? 'tap' : 'stroke';
    }

}
