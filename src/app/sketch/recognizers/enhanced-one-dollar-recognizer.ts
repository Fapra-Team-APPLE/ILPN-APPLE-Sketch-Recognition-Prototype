import {
    BoundingBox,
    computeBoundingBox,
    distance,
    pathLength,
    Point,
    RecognitionCandidate,
    RecognitionResult,
    ShapeType,
    StrokePoint
} from './recognition-types';
import {IStrokeRecognizer} from './stroke-recognizer.interface';

const NUM_RESAMPLED_POINTS = 64;
const SQUARE_SIZE = 250;
const HALF_DIAGONAL = 0.5 * Math.sqrt(SQUARE_SIZE * SQUARE_SIZE + SQUARE_SIZE * SQUARE_SIZE);
const ANGLE_RANGE = Math.PI / 4; // ±45°
const ANGLE_PRECISION = Math.PI / 90; // 2°
const PHI = 0.5 * (-1 + Math.sqrt(5)); // golden ratio

interface Template {
    name: ShapeType;
    points: Point[];
}

interface SpeedFeatures {
    /** Korrelation zwischen hoher Krümmung und geringem Speed. Hoch = Verlangsamung an Ecken (wahrscheinlich eher rechteckig) */
    cornerSlowdownScore: number;
}

interface GeometricFeatures {
    /** 4π*Fläche / Umfang^2 (Kreis ≈ 1.0, Rechteck ≈ 0.785) */
    compactness: number;
    /** Gleichmäßigkeit der Winkeländerungsverteilung. Hoch = wahrscheinlich eher Kreis */
    angularUniformity: number;
}

/**
 * Implementierung des $1 Unistroke-Recognizers
 *
 * Basierend auf:
 * Wobbrock, J.O., Wilson, A.D. and Li, Y. (2007). Gestures without libraries, toolkits or training: A $1 recognizer for user interface prototypes. Proceedings of the ACM
 * Symposium on User Interface Software and Technology (UIST '07). Newport, Rhode Island (October 7-10, 2007). New York: ACM Press, pp. 159-168.
 * https://dl.acm.org/citation.cfm?id=1294238
 *
 * Zusätzliche Heuristiken:
 * - Linienerkennung über das Linearitätsverhältnis (Pfadlänge vs. Start-Ende-Distanz)
 * - Punkterkennung für sehr kurze Strokes
 * - Scribble-Erkennung über die Richtungswechsel-Frequenz
 * - Rechteck-Confidence adjusted durch zusätzliche Features für bessere Genauigkeit
 */
export class EnhancedOneDollarRecognizer implements IStrokeRecognizer {

    private readonly templates: Template[] = [];

    constructor() {
        this.loadDefaultTemplates();
    }


    recognize(points: StrokePoint[]): RecognitionResult {
        const bbox = computeBoundingBox(points);
        const center = {x: bbox.cx, y: bbox.cy};

        if (this.isDot(points, bbox)) {
            const candidate: RecognitionCandidate = {shape: 'dot', confidence: 1, boundingBox: bbox, center};
            return {best: candidate, alternatives: [], rawPoints: points};
        }

        const lineConfidence = this.computeLineConfidence(points);
        const lineCandidate: RecognitionCandidate = {shape: 'line', confidence: lineConfidence, boundingBox: bbox, center};

        const scribbleConfidence = this.computeScribbleConfidence(points);
        const scribbleCandidate: RecognitionCandidate = {shape: 'scribble', confidence: scribbleConfidence, boundingBox: bbox, center};

        // tatsächliches $1 Template-Matching
        const processedPoints = this.preprocess(points);
        const templateResults: RecognitionCandidate[] = [];

        for (const template of this.templates) {
            const d = this.distanceAtBestAngle(processedPoints, template.points, -ANGLE_RANGE, ANGLE_RANGE, ANGLE_PRECISION);
            const score = 1 - (d / HALF_DIAGONAL);
            templateResults.push({
                shape: template.name,
                confidence: Math.max(0, score),
                boundingBox: bbox,
                center
            });
        }

        // Speed- & Geometrie-Merkmalsextraktion (zur besseren Unterscheidung Kreis vs. Rechteck)
        const speedFeatures = this.extractSpeedFeatures(points);
        const geoFeatures = this.extractGeometricFeatures(points);

        for (const candidate of templateResults) {
            if (candidate.shape === 'rectangle') {
                candidate.confidence = this.adjustRectangleConfidence(candidate.confidence, speedFeatures, geoFeatures);
            }
        }


        const allCandidates = [...templateResults, lineCandidate, scribbleCandidate];
        allCandidates.sort((a, b) => b.confidence - a.confidence);

        const best = allCandidates[0];
        const alternatives = allCandidates.slice(1);

        return {best, alternatives, rawPoints: points};
    }

    addTemplate(name: string, points: StrokePoint[]): void {
        const processed = this.preprocess(points);
        this.templates.push({name: name as ShapeType, points: processed});
    }


    private isDot(points: StrokePoint[], bbox: BoundingBox): boolean {
        const MAX_DOT_SIZE = 15; // px
        const MAX_DOT_POINTS = 20;
        return points.length <= MAX_DOT_POINTS && bbox.w < MAX_DOT_SIZE && bbox.h < MAX_DOT_SIZE;
    }

    /**
     * Linien-Confidence: Verhältnis von Start-Ende-Distanz zur gesamten Pfadlänge (Eine perfekte Linie hat ein Verhältnis von 1)
     */
    private computeLineConfidence(points: StrokePoint[]): number {
        if (points.length < 2) {
            return 0;
        }
        const totalPath = pathLength(points);
        if (totalPath < 30) {
            return 0; // zu kurz für eine Line
        }
        const directDist = distance(points[0], points[points.length - 1]);
        const ratio = directDist / totalPath;
        // Verhältnis auf Confidence abbilden: 0.95+ -> hoch, <0.7 -> niedrig
        return Math.max(0, Math.min(1, (ratio - 0.7) / 0.25));
    }

    /**
     * Scribble-Confidence: Frequenz von scharfen Richtungswechseln
     */
    private computeScribbleConfidence(points: StrokePoint[]): number {
        if (points.length < 8) return 0;

        const totalPath = pathLength(points);
        if (totalPath < 40) return 0; // zu kurz

        let reversals = 0;
        // Feste Schrittgröße funktioniert am besten, um hochfrequentes Jitter zu filtern, aber strukturelles Zickzack zu erfassen
        const step = 2;

        for (let i = step; i < points.length - step; i++) {
            const prev = points[i - step];
            const curr = points[i];
            const next = points[i + step];

            const dx1 = curr.x - prev.x;
            const dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x;
            const dy2 = next.y - curr.y;

            // Skalarprodukt aufeinanderfolgender Richtungsvektoren
            const dot = dx1 * dx2 + dy1 * dy2;
            const magnitude1 = Math.hypot(dx1, dy1);
            const magnitude2 = Math.hypot(dx2, dy2);

            if (magnitude1 > 1.0 && magnitude2 > 1.0) { // Kleines Rauschen ignorieren
                const cosAngle = dot / (magnitude1 * magnitude2);
                if (cosAngle < -0.2) { // Winkel > ~101,5° = scharfe Umkehrung
                    reversals++;
                    i += step; // weitergehen, um ein doppeltes Zählen derselben Kurve zu vermeiden
                }
            }
        }

        // Scribbles haben viele scharfe Kurven-Reversals. Kreise/Rechtecke/Lines haben 0
        if (reversals >= 3) {
            return Math.min(1, 0.8 + (reversals * 0.05)); // Hoher Confidence-Boost
        }
        if (reversals === 2) {
            return 0.45;
        }
        return 0;
    }


    private preprocess(points: StrokePoint[]): Point[] {
        let pts: Point[] = points.map(p => ({x: p.x, y: p.y}));
        pts = this.resample(pts, NUM_RESAMPLED_POINTS);
        pts = this.rotateToZero(pts);
        pts = this.scaleToSquare(pts, SQUARE_SIZE);
        pts = this.translateToOrigin(pts);
        return pts;
    }

    private resample(points: Point[], n: number): Point[] {
        const totalLength = pathLength(points);
        const interval = totalLength / (n - 1);
        const resampled: Point[] = [points[0]];
        let accumulatedDist = 0;

        for (let i = 1; i < points.length; i++) {
            const d = distance(points[i - 1], points[i]);
            if (accumulatedDist + d >= interval) {
                const ratio = (interval - accumulatedDist) / d;
                const newX = points[i - 1].x + ratio * (points[i].x - points[i - 1].x);
                const newY = points[i - 1].y + ratio * (points[i].y - points[i - 1].y);
                const newPt: Point = {x: newX, y: newY};
                resampled.push(newPt);
                // Den neuen Punkt einfügen, sodass er als Start des nächsten Segments verwendet wird
                points.splice(i, 0, newPt);
                accumulatedDist = 0;
            } else {
                accumulatedDist += d;
            }
        }

        if (resampled.length === n - 1) {
            // Aufgrund von Rundungen fehlt möglicherweise ein Punkt: Falls erforderlich, den letzten Punkt hinzufügen
            resampled.push(points[points.length - 1]);
        }
        return resampled;
    }

    private rotateToZero(points: Point[]): Point[] {
        const centroid = this.centroid(points);
        const angle = Math.atan2(centroid.y - points[0].y, centroid.x - points[0].x);
        return this.rotateBy(points, -angle);
    }

    private scaleToSquare(points: Point[], size: number): Point[] {
        const box = computeBoundingBox(points);
        const scaleX = box.w > 0 ? size / box.w : 1;
        const scaleY = box.h > 0 ? size / box.h : 1;
        return points.map(p => ({x: p.x * scaleX, y: p.y * scaleY}));
    }

    private translateToOrigin(points: Point[]): Point[] {
        const centroid = this.centroid(points);
        return points.map(p => ({x: p.x - centroid.x, y: p.y - centroid.y}));
    }

    private distanceAtBestAngle(points: Point[], template: Point[], a: number, b: number, threshold: number): number {
        let x1 = PHI * a + (1 - PHI) * b;
        let f1 = this.distanceAtAngle(points, template, x1);
        let x2 = (1 - PHI) * a + PHI * b;
        let f2 = this.distanceAtAngle(points, template, x2);

        while (Math.abs(b - a) > threshold) {
            if (f1 < f2) {
                b = x2;
                x2 = x1;
                f2 = f1;
                x1 = PHI * a + (1 - PHI) * b;
                f1 = this.distanceAtAngle(points, template, x1);
            } else {
                a = x1;
                x1 = x2;
                f1 = f2;
                x2 = (1 - PHI) * a + PHI * b;
                f2 = this.distanceAtAngle(points, template, x2);
            }
        }
        return Math.min(f1, f2);
    }

    private distanceAtAngle(points: Point[], template: Point[], angle: number): number {
        const rotated = this.rotateBy(points, angle);
        return this.pathDistance(rotated, template);
    }

    private pathDistance(a: Point[], b: Point[]): number {
        let total = 0;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            total += distance(a[i], b[i]);
        }
        return total / len;
    }


    private centroid(points: Point[]): Point {
        let sumX = 0, sumY = 0;
        for (const p of points) {
            sumX += p.x;
            sumY += p.y;
        }
        return {x: sumX / points.length, y: sumY / points.length};
    }

    private rotateBy(points: Point[], angle: number): Point[] {
        const c = this.centroid(points);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return points.map(p => ({
            x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
            y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y
        }));
    }

    private extractSpeedFeatures(points: StrokePoint[]): SpeedFeatures {
        if (points.length < 3) {
            return {cornerSlowdownScore: 0};
        }

        // Geschwindigkeit pro Segment berechnen
        const speeds: number[] = [];
        for (let i = 1; i < points.length; i++) {
            const deltaTime = points[i].timestamp - points[i - 1].timestamp;
            const deltaDistance = distance(points[i - 1], points[i]);
            speeds.push(deltaTime > 0 ? deltaDistance / deltaTime : 0);
        }

        // Segmente mit einer Geschwindigkeit von Null rausfiltern (Pausen)
        const nonZeroSpeeds = speeds.filter(speed => speed > 0);
        if (nonZeroSpeeds.length < 2) {
            return {cornerSlowdownScore: 0};
        }

        // Corner-Slowdown: Krümmung mit inverser Geschwindigkeit korrelieren (An Punkten mit hoher Krümmung verlangsamt man beim Zeichnen von Rechtecken)
        const step = Math.max(2, Math.floor(points.length / 32));
        const curvatures: number[] = [];
        const segmentSpeeds: number[] = [];
        const {startIndex, endIndex} = this.getFeatureExtractionRange(points.length, step);

        for (let i = startIndex; i < endIndex; i++) {
            const curvature = this.computeLocalCurvature(points, i, step);
            if (curvature !== null) {
                curvatures.push(curvature);
                // Ungefähre Geschwindigkeit an diesem spezifischen Punkt
                const index = Math.max(0, Math.min(i - 1, speeds.length - 1));
                segmentSpeeds.push(speeds[index]);
            }
        }

        let cornerSlowdownScore = 0;
        if (curvatures.length > 4) {
            // Jede Krümmung mit ihrer Segment-Geschwindigkeit paaren
            const curvatureSpeedPairs = curvatures.map((curvature, index) => ({
                curvature,
                speed: segmentSpeeds[index]
            }));

            // Die obersten 20 % der Punkte mit der höchsten Krümmung nehmen
            curvatureSpeedPairs.sort((a, b) => b.curvature - a.curvature);
            const highCurvatureCount = Math.floor(curvatures.length * 0.2);
            const highCurvaturePairs = curvatureSpeedPairs.slice(0, highCurvatureCount);

            // Prüfen, wie viele dieser obersten 20 %-Punkte eine Geschwindigkeit unter 80 % des Durchschnitts haben
            const averageSpeed = segmentSpeeds.reduce((sum, speed) => sum + speed, 0) / segmentSpeeds.length;
            const slowCornersCount = highCurvaturePairs.filter(pair => pair.speed < averageSpeed * 0.8).length;

            cornerSlowdownScore = highCurvatureCount > 0 ? slowCornersCount / highCurvatureCount : 0;
        }

        return {cornerSlowdownScore};
    }

    private extractGeometricFeatures(points: StrokePoint[]): GeometricFeatures {
        if (points.length < 4) {
            return {compactness: 0, angularUniformity: 0};
        }

        const perimeter = pathLength(points);

        // Gaußsche Trapezformel
        let signedArea = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            signedArea += points[i].x * points[j].y;
            signedArea -= points[j].x * points[i].y;
        }
        const area = Math.abs(signedArea) / 2;

        // Kompaktheit: 4π*A / P^2. Kreis = 1.0, Quadrat ≈ 0.785
        const compactness = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

        const step = Math.max(3, Math.floor(points.length / 20));
        const angles: number[] = [];
        const {startIndex, endIndex} = this.getFeatureExtractionRange(points.length, step);

        for (let i = startIndex; i < endIndex; i++) {
            const angle = this.computeLocalCurvature(points, i, step);
            if (angle !== null) {
                angles.push(angle);
            }
        }

        // Gleichmäßigkeit der Winkel: Geringe Standardabweichung der Winkeländerungen = kreisähnlich
        let angularUniformity = 0;
        if (angles.length > 2) {
            const meanAngle = angles.reduce((a, b) => a + b, 0) / angles.length;
            const angleVariance = angles.reduce((a, v) => a + (v - meanAngle) ** 2, 0) / angles.length;
            const angleStandardDeviation = Math.sqrt(angleVariance);
            // Normalisieren: Standardabweichung von 0 = perfekte Gleichmäßigkeit (1)
            // Geteilt durch Math.PI / 2 (90 Grad), da die maximale typische Winkelabweichung (an Rechteckecken) 90 Grad beträgt
            angularUniformity = Math.max(0, 1 - angleStandardDeviation / (Math.PI / 2));
        }

        return {compactness, angularUniformity};
    }

    /**
     * Berechnet die lokale Krümmung (Winkeldifferenz im Bogenmaß) am Punktindex `i` eines Strokes
     * @returns null, wenn eine Segmentlänge zu klein ist, um eine Division durch Null oder Jitter zu vermeiden
     */
    private computeLocalCurvature(points: Point[], i: number, step: number): number | null {
        const previousPoint = points[i - step];
        const currentPoint = points[i];
        const nextPoint = points[i + step];
        const deltaX1 = currentPoint.x - previousPoint.x;
        const deltaY1 = currentPoint.y - previousPoint.y;
        const deltaX2 = nextPoint.x - currentPoint.x;
        const deltaY2 = nextPoint.y - currentPoint.y;
        const magnitude1 = Math.hypot(deltaX1, deltaY1);
        const magnitude2 = Math.hypot(deltaX2, deltaY2);
        if (magnitude1 > 0.5 && magnitude2 > 0.5) {
            const cosineAngle = Math.max(-1, Math.min(1, (deltaX1 * deltaX2 + deltaY1 * deltaY2) / (magnitude1 * magnitude2)));
            return Math.acos(cosineAngle);
        }
        return null;
    }

    /**
     * Gibt den Indexbereich zurück, über den bei der Merkmalsextraktion eines Strokes iteriert werden soll, wobei ein bestimmter Prozentsatz am Anfang und Ende ignoriert
     * wird, um Artefakte beim Auf-/Absetzen des Stifts zu filtern
     *
     * Standard: Die ersten 5 % (Anfangshaken/Jitter) und die letzten 10 % (end overshoot) ignorieren
     */
    private getFeatureExtractionRange(pointsLength: number, step: number, startIgnoreRatio = 0.05, endIgnoreRatio = 0.10): {startIndex: number; endIndex: number} {
        const startIndex = Math.max(step, Math.floor(pointsLength * startIgnoreRatio));
        const endIndex = Math.min(pointsLength - step, Math.floor(pointsLength * (1 - endIgnoreRatio)));
        return {startIndex, endIndex};
    }

    /**
     * Gibt einen angepassten Confidence-Wert für einen Rechteckkandidaten basierend auf den Features zurück
     */
    private adjustRectangleConfidence(baseConfidence: number, speedFeatures: SpeedFeatures, geometricFeatures: GeometricFeatures): number {
        let adjustment = 0;

        // Primäres Unterscheidungsmerkmal: Gleichmäßigkeit der Winkel (Empirisch: Kreise >= 0.813, Rechtecke <= 0.805)
        const isSmooth = geometricFeatures.angularUniformity > 0.81;

        // Sekundäres Unterscheidungsmerkmal: Corner-Slowdown (Rechtecke zeigen durchweg Verlangsamungen > 0.65)
        const hasCornerSlowdowns = speedFeatures.cornerSlowdownScore > 0.65;

        if (isSmooth) {
            adjustment -= 0.1;
        } else {
            adjustment += 0.1;
        }

        if (hasCornerSlowdowns) {
            adjustment += 0.05;
        }

        // Leichtes Kompaktheitssignal (Verstärkung bei niedrigem/unregelmäßigem Wert, Abzug bei stark kreisähnlichem Wert)
        if (geometricFeatures.compactness < 0.65) {
            adjustment += 0.03;
        } else if (geometricFeatures.compactness > 0.8) {
            adjustment -= 0.03;
        }

        return Math.max(0, Math.min(1, baseConfidence + adjustment));
    }

    private loadDefaultTemplates(): void {
        this.addTemplate('circle', this.generateCircleTemplate());
        this.addTemplate('rectangle', this.generateRectangleTemplate());
        this.addTemplate('circle', this.generateCircleTemplate(true));
        this.addTemplate('rectangle', this.generateRectangleTemplate(true));
    }

    private generateCircleTemplate(counterClockwise = false): StrokePoint[] {
        const points: StrokePoint[] = [];
        const n = 64;
        const dir = counterClockwise ? -1 : 1;
        for (let i = 0; i <= n; i++) {
            const angle = dir * (2 * Math.PI * i) / n;
            points.push({
                x: 100 + 80 * Math.cos(angle),
                y: 100 + 80 * Math.sin(angle),
                timestamp: i
            });
        }
        return points;
    }

    private generateRectangleTemplate(counterClockwise = false): StrokePoint[] {
        const corners = counterClockwise
            ? [{x: 0, y: 0}, {x: 0, y: 100}, {x: 150, y: 100}, {x: 150, y: 0}, {x: 0, y: 0}]
            : [{x: 0, y: 0}, {x: 150, y: 0}, {x: 150, y: 100}, {x: 0, y: 100}, {x: 0, y: 0}];

        const points: StrokePoint[] = [];
        const pointsPerSide = 16;
        let t = 0;

        for (let s = 0; s < corners.length - 1; s++) {
            const from = corners[s];
            const to = corners[s + 1];
            for (let i = 0; i < pointsPerSide; i++) {
                const ratio = i / pointsPerSide;
                points.push({
                    x: from.x + ratio * (to.x - from.x),
                    y: from.y + ratio * (to.y - from.y),
                    timestamp: t++
                });
            }
        }
        // Form schließen
        points.push({x: corners[corners.length - 1].x, y: corners[corners.length - 1].y, timestamp: t});
        return points;
    }

}
