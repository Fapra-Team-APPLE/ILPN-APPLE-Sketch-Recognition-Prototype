import * as tf from '@tensorflow/tfjs-core';
import {LayersModel, loadLayersModel} from '@tensorflow/tfjs-layers';
import '@tensorflow/tfjs-backend-webgl';
import {DigitRecognitionResult, IDigitRecognizer} from './digit-recognizer.interface';
import {StrokePoint} from './recognition-types';

/**
 * Ziffernerkenner unter Verwendung von TensorFlow.js mit einem vortrainierten Convolutional Neural Network (CNN)
 */
export class TensorFlowDigitRecognizer implements IDigitRecognizer {

    private model: LayersModel | null = null;

    constructor() {
        this.loadModel();
    }

    private async loadModel(): Promise<void> {
        try {
            // Modellquelle: https://github.com/aralroca/MNIST_React_TensorFlowJS
            this.model = await loadLayersModel('assets/model/model.json');
            await this.warmupModel();
        } catch (error) {
            console.error('Could not load TensorFlow.js model from assets/model/model.json.', error);
        }
    }

    private async warmupModel(): Promise<void> {
        if (!this.model) {
            return;
        }
        // Asynchrone Dummy-Inferenz ausführen, um Page Freeze beim ersten echten Stroke in einer Stelle zu vermeiden
        const dummy = tf.zeros([1, 28, 28, 1]);
        const warmupResult = this.model!.predict(dummy) as tf.Tensor;
        await warmupResult.data();
        dummy.dispose();
        warmupResult.dispose();
    }

    recognize(points: StrokePoint[]): DigitRecognitionResult | null {
        if (points.length === 0) {
            return null;
        }
        if (!this.model) {
            return null;
        }

        return this.recognizeMultiStroke([points]);
    }

    recognizeMultiStroke(strokes: StrokePoint[][]): DigitRecognitionResult | null {
        if (strokes.length === 0 || strokes.every(s => s.length === 0)) {
            return null;
        }
        if (!this.model) {
            return null;
        }

        try {
            const pixels = this.preprocessStrokes(strokes);

            const result = tf.tidy(() => {
                const rawTensor = tf.tensor(pixels);
                const inputTensor = tf.reshape(rawTensor, [1, 28, 28, 1]);
                const prediction = this.model!.predict(inputTensor) as tf.Tensor;
                const probabilities = prediction.dataSync();
                const bestIndex = tf.argMax(prediction, 1).dataSync()[0];
                const confidence = probabilities[bestIndex];

                return {
                    digit: bestIndex,
                    confidence: confidence
                };
            });

            if (result.confidence < 0.65) {
                return null;
            }

            return result;
        } catch (error) {
            console.error('Error during TensorFlow.js digit recognition:', error);
            return null;
        }
    }

    /**
     * Konvertiert eine Reihe von Strokes in ein normalisiertes 28x28 Graustufen-Pixelarray
     */
    private preprocessStrokes(strokes: StrokePoint[][]): Float32Array {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 28;
        tempCanvas.height = 28;
        const context = tempCanvas.getContext('2d', {willReadFrequently: true});
        if (!context) {
            return new Float32Array(784);
        }

        // Bounding Box aller Strokes berechnen
        const allPoints = strokes.flat();
        if (allPoints.length === 0) {
            return new Float32Array(784);
        }

        const xs = allPoints.map(p => p.x);
        const ys = allPoints.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        const width = maxX - minX;
        const height = maxY - minY;
        const size = Math.max(width, height, 1);

        context.fillStyle = 'black';
        context.fillRect(0, 0, 28, 28);

        // Zeichnungs-Center mit proportionaler Skalierung auf das 28x28-Center abbilden
        const targetSize = 20; // Ziffern in einem zentrierten 20x20-Bereich zeichnen, um der MNIST-Verteilung zu entsprechen
        const scale = targetSize / size;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const offsetX = 14 - cx * scale;
        const offsetY = 14 - cy * scale;

        // Strokes mit kontrastreicher weißer Farbe auf den 28x28-Canvas zeichnen
        context.strokeStyle = 'white';
        context.lineWidth = 3;
        context.lineCap = 'round';
        context.lineJoin = 'round';

        for (const stroke of strokes) {
            if (stroke.length === 0) {
                continue;
            }
            context.beginPath();
            context.moveTo(stroke[0].x * scale + offsetX, stroke[0].y * scale + offsetY);
            for (let i = 1; i < stroke.length; i++) {
                context.lineTo(stroke[i].x * scale + offsetX, stroke[i].y * scale + offsetY);
            }
            context.stroke();
        }

        const imgData = context.getImageData(0, 0, 28, 28);

        // Pixel normalisieren und anhand des Center of Mass zentrieren
        return this.centerByCenterOfMass(imgData);
    }

    /**
     * Hilft dabei die Erkennung von Ziffern mit Haken oder Serifen (wie 1en und 7en) zu verbessern
     */
    private centerByCenterOfMass(imgData: ImageData): Float32Array {
        let totalMass = 0;
        let sumX = 0;
        let sumY = 0;

        for (let y = 0; y < 28; y++) {
            for (let x = 0; x < 28; x++) {
                // Aus dem Grünkanal lesen, da die Ziffern in Weiß auf Schwarz gezeichnet werden
                const pixelVal = imgData.data[(y * 28 + x) * 4 + 1];
                if (pixelVal > 0) {
                    totalMass += pixelVal;
                    sumX += x * pixelVal;
                    sumY += y * pixelVal;
                }
            }
        }

        const pixels = new Float32Array(784);
        if (totalMass > 0) {
            const centerX = sumX / totalMass;
            const centerY = sumY / totalMass;

            // Pixel-Shifts berechnen, um das Center of Mass auf das (14, 14)-Center auszurichten
            const shiftX = Math.round(14 - centerX);
            const shiftY = Math.round(14 - centerY);

            // Pixel auf ein 28x28-Ausgaberaster shiften
            for (let y = 0; y < 28; y++) {
                for (let x = 0; x < 28; x++) {
                    const targetX = x + shiftX;
                    const targetY = y + shiftY;
                    if (targetX >= 0 && targetX < 28 && targetY >= 0 && targetY < 28) {
                        const sourceVal = imgData.data[(y * 28 + x) * 4];
                        pixels[targetY * 28 + targetX] = sourceVal / 255;
                    }
                }
            }
        } else {
            // Fallback: einfache Kopie, wenn keine Farbpixel auf dem Canvas vorhanden sind
            for (let i = 0; i < 784; i++) {
                pixels[i] = imgData.data[i * 4] / 255;
            }
        }

        return pixels;
    }

}
