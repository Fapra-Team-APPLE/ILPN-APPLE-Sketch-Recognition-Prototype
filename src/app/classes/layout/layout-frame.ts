/**
 * Ein LayoutFrame fasst die Position aller Knoten zu einem Zeitpunkt im
 * Force-Simulator zusammen,
 * Einzelnes Layout-Zwischenresultat (= der LayoutFrame) wird optional vom LayoutService erzeugt,und im
 * Diagram wird die Iterationsnummer und die gerundeten Koordinaten aller Knoten gespeichert,
 * damit DisplayComponent die Iterationen die Bewegung Bild für Bild wiedergeben kann (-> die Animation).
 */
export interface LayoutFrame {
    iteration: number;
    /** Liste aller Knotenpositionen im betreffenden Tick. Für jedes ID-Paar wird
     ' die bereits gerundete Bildschirmkoordinate gespeichert, damit spätere
     * Replays exakt dem finalen Layout entsprechen.
     * */
    positions: Array<{id: string; x: number; y: number}>;
    maxDisplacement?: number;
}
