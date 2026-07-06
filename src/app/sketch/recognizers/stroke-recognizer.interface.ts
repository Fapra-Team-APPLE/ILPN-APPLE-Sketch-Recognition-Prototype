import {RecognitionResult, StrokePoint} from './recognition-types';

/**
 * Interface für Uni-Stroke-Erkennung
 */
export interface IStrokeRecognizer {

    /**
     * Erkennt eine Form aus einem einzelnen abgeschlossenen Uni-Stroke
     * @param points Die aufgezeichneten Stroke-Points
     * @returns Ein RecognitionResult mit dem besten Match und Alternativen
     */
    recognize(points: StrokePoint[]): RecognitionResult;

}
