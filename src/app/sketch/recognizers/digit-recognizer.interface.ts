import {StrokePoint} from './recognition-types';

export interface DigitRecognitionResult {
    /** Erkannte Ziffer (0-9) */
    digit: number;
    /** Confidence-Wert zwischen 0 und 1 */
    confidence: number;
}

export interface IDigitRecognizer {
    /**
     * Versucht, eine Ziffer aus einem einzelnen Stroke (Uni-Stroke) zu erkennen
     * @returns null, wenn der Stroke nicht wie eine Ziffer aussieht
     */
    recognize(points: StrokePoint[]): DigitRecognitionResult | null;

    /**
     * Versucht, eine Ziffer aus mehreren Strokes zu erkennen (z. B. bei Ziffern wie "4" aus zwei Strokes)
     * (Fallback auf Einzel-Stroke-Erkennung, wenn nur ein Stroke übergeben wird)
     * @returns null, wenn die Strokes nicht wie eine Ziffer aussehen
     */
    recognizeMultiStroke?(strokes: StrokePoint[][]): DigitRecognitionResult | null;
}
