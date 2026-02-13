import {Injectable} from '@angular/core';
import {Diagram} from '../classes/diagram/diagram';
import {IDiagramNode} from '../classes/diagram/diagram-types';
import {LayoutFrame} from '../classes/layout/layout-frame';

export type {LayoutFrame};

interface LayoutConfig {
    width?: number;
    height?: number;
    iterations?: number;
    linkDistance?: number;
    chargeStrength?: number;
    collideRadiusNodes?: number;
    centerStrength?: number;
    velocityDecay?: number;
    // Anzahl Ticks, in denen sich das Netz fast nicht bewegt haben muss, bevor abgebrochen wird
    stationaryTicks?: number;
    // Maximale Bewegung (Pixel) pro Tick, um als "still" zu gelten
    movementEpsilon?: number;
    frames?: LayoutFrame[];
    randomSeed?: number;
    onIteration?: (iteration: number, positions: Array<{id: string; x: number; y: number}>) => void;
    horizontalOrientationStrength?: number;
    // extra Abstand zur Kante
    edgePadding?: number;
    // Stärke der Node-Edge-Abstoßung
    edgeAvoidStrength?: number;
}

interface ForceNode {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

@Injectable({
    providedIn: 'root'
})
export class LayoutService {


    /**
     * Zentraler Einstieg in das automatische Layout der Petrinetz-Grafiken.
     *
     * Warum existiert dieser Service?
     * - Parser und Editor wollen Netze auch ohne explizite Koordinaten anzeigen können.
     * - Animation benötigt reproduzierbare Zwischenstände (Frames), um
     *   Layout-Schritte zu visualisieren oder Debugging zu erleichtern.
     *
     * Ansatz
     *   aus dem klassischen Fruchterman–Reingold-Algorithmus. Die Implementierung orientiert sich
     *   aber am D3-Force-Modell -> Gründe: leicht verständlich, stabil und
     *   gut für sukzessive Animation geeignet ist.
     * - Jeder Durchlauf ("Tick") berechnet Kräfte aus vier Komponenten:
     *     - Kantenlänge (applyLinkForce): zieht verbundene Knoten zueinander.
     *     - Abstoßung (applyManyBodyForce): verhindert Überlagerungen und schafft Raum.
     *     - Zentrierung (applyCenterForce): hält das Netz in der Zeichenfläche.
     *     - Kollision (applyCollisionForce): minimale Distanz zwischen Knoten.
     *   Anschließend integriert integrate() die Geschwindigkeiten und dämpft sie.
     * - Optional wird nach jedem Tick ein Frame aufgezeichnet. Das Display-Component
     *   animiert diese Frames später sequentiell, um dem Nutzer den Layout-Verlauf
     *   zu zeigen.
     *
     */
    applyForceDirectedLayout(diagram: Diagram, config: LayoutConfig = {}): Diagram {
        const nodes = diagram.nodes;
        if (nodes.length === 0) {
            return diagram;
        }

        // Zielbreite des Zeichenbereichs (Abhängig v. Viewport)
        const targetWidth = config.width ?? 1000;
        // Zielhöhe des Zeichenbereichs (Abhängig v. Viewport)
        const targetHeight = config.height ?? 400;

        // Referenzgrößen für die Simulation
        //  virtuelle Simulationsfläche wächst in X UND Y, damit große Netze Platz haben,
        // auch wenn das echte Canvas (targetHeight) fix ist.
        const baseWidth = 1000;
        const baseHeight = 400;
        const n = nodes.length;
        let sizeScale = 1;
        if (n > 10 && n < 20) {
            sizeScale = 1 + (n - 10) * 0.08;
        } else if (n >= 20) {
            sizeScale = 1.8 + (n - 20) * 0.12;
        }

        // Zielbreite des Zeichenbereichs
        const width = baseWidth * sizeScale; // changed: virtuelle Simulationsbreite
        // Zielhöhe des Zeichenbereichs
        const height = baseHeight * sizeScale; // changed: virtuelle Simulationshöhe

        // Anzahl Simulations-Durchläufe
        const iterations = config.iterations ?? 400;
        // Soll-Abstand verbundener Knoten
        const linkDistance = config.linkDistance ?? 120;
        // Stärke der Abstoßung
        const chargeStrength = config.chargeStrength ?? -2200;
        // angenommener Knotenradius für Kollisionen
        const collideRadius = config.collideRadiusNodes ?? 80;
        // Zukraft zum Mittelpunkt des Zeichenbereichs
        const centerStrength = config.centerStrength ?? 0.01;
        // D3-Force default: 0.4
        const velocityDecay = config.velocityDecay ?? 0.4;// D3-Force default: 0.4
        // Anzahl ruhiger Ticks, nach denen die Simulation abgebrochen wird (Standard: ~0,1s bei 60fps)
        const stationaryTicksRequired = config.stationaryTicks ?? 5;
        // Maximal erlaubte Bewegung pro Tick, um als "still" zu gelten
        const movementEpsilon = config.movementEpsilon ?? 0.001;
        // ...
        const horizontalOrientationStrength = config.horizontalOrientationStrength ?? 0.06;
        // optionaler Callback pro Iteration
        const onIteration = config.onIteration;
        // optionales Frame-Array zur Animation
        const frames = config.frames;
        // Ein reproduzierbarer Zufallszahlengenerator. Seed hängt an den IDs, sodass das Layout stabil bleibt, solange die Knotenmenge unverändert ist.
        const random = this.createRandomGenerator(config.randomSeed ?? this.hashNodeIds(nodes));
        // Vorbereitung der internen ForceNode-Struktur mit Startpositionen
        const forceNodes = this.initializeForceNodes(nodes, width, height, random, targetWidth, targetHeight);

        const placeIdsInOrder = nodes.filter(node => node.kind === 'place').map(node => node.id);
        const leftPlaceId = placeIdsInOrder[0];
        const rightPlaceId = placeIdsInOrder[placeIdsInOrder.length - 1];
        const layoutPaddingLeft = 0;
        const minX = layoutPaddingLeft;
        const layoutPaddingRight = 0;
        const maxX = width - layoutPaddingRight;
        const edgePadding = config.edgePadding ?? 15;
        const edgeAvoidStrength = config.edgeAvoidStrength ?? 0.50;

        if (leftPlaceId && rightPlaceId && leftPlaceId !== rightPlaceId && forceNodes.length > 0) {
            const nodeById = new Map(forceNodes.map(node => [node.id, node]));
            const leftNode = nodeById.get(leftPlaceId);
            const rightNode = nodeById.get(rightPlaceId);
            if (leftNode) {
                leftNode.x = minX;
                leftNode.vx = 0;
            }
            if (rightNode) {
                rightNode.x = maxX;
                rightNode.vx = 0;
            }
        }

        // Reduzieren der Kanten auf minimale Strukur, um Forces schneller zu berechnen
        const links = diagram.edges.map(edge => ({source: edge.source.id, target: edge.target.id}));

        // Steuert die Schrittweite beim D3-Force-Integrator, wird pro Tick reduziert, damit sich das Netz beruhigt
        let alpha = 0.7;
        const alphaMin = 0.001; // Schleife bricht bei Untergrenze ab
        const alphaDecay = 1 - Math.pow(alphaMin, 1 / iterations); // entspricht d3.alphaDecay
        const alphaTarget = 0; // Zielwert, gegen den alpha strebt

        // Für die Bewegungsauswertung merken wir uns pro Node die letzte Position
        const previousPositions = forceNodes.map(({x, y}) => ({x, y}));

        //  Mapping von virtueller Simulationsfläche auf echtes Canvas (targetWidth/targetHeight)
        const mapToTarget = (x: number, y: number): {x: number; y: number} => {
            const margin = 65;
            const simMinX = margin;
            const simMaxX = width - margin;
            const simMinY = margin;
            const simMaxY = height - margin;

            const tgtMinX = margin;
            const tgtMaxX = targetWidth - margin;
            const tgtMinY = margin;
            const tgtMaxY = targetHeight - margin;

            const sx = (tgtMaxX - tgtMinX) / ((simMaxX - simMinX) || 0.0001);
            const sy = (tgtMaxY - tgtMinY) / ((simMaxY - simMinY) || 0.0001);

            const mx = tgtMinX + (x - simMinX) * sx;
            const my = tgtMinY + (y - simMinY) * sy;

            return {x: this.clamp(mx, tgtMinX, tgtMaxX), y: this.clamp(my, tgtMinY, tgtMaxY)};
        };

        // delete waypoints for Layouting -> ignoriert Anchor points aus JSONs
        this.cleanUpWaypoints(diagram);

        // erster Frame hält Startzustand fest -> hilt dabei Bewegungen zu den Initialwerten zu visualisierten
        this.captureFrame({iteration: 0, nodes: forceNodes, onIteration, frames, mapToTarget}); // changed

        // --- Stabilitätsüberwachung ---
        // Wir betrachten die tatsächlich zurückgelegte Strecke pro Tick.
        // Bewegt sich kein Node mehr als movementEpsilon Pixel und das über
        // mehrere Ticks hinweg, wird die Simulation abgebrochen. So
        // reduzieren wir Mikrobewegungen, ohne den normalen Einpendel-Vorgang
        // zu stören.
        let stationaryTicks = 0; // zählt aufeinanderfolgende „ruhige“ Ticks
        for (let i = 0; i < iterations && alpha > alphaMin; i++) {
            // Die folgenden Kraftberechnungen modifizieren nur Geschwindigkeiten (vx/vy)
            // bzw. Positionen innerhalb des lokalen ForceNode-Arrays. Die tatsächlichen
            // Diagramm-Knoten werden erst nach Abschluss aller Iterationen aktualisiert.
            // 1) Kantenkräfte anlegen, damit verbundene Knoten in sinnvoller Distanz bleiben
            this.applyLinkForce(forceNodes, links, linkDistance, alpha);
            // 2) Abstoßende Kraft berechnen, verhindert Klumpenbildung
            this.applyManyBodyForce(forceNodes, chargeStrength, alpha);
            // 3) softe Zentrierung anwenden
            this.applyCenterForce(forceNodes, width / 2, height / 2, centerStrength, alpha);
            const maxDisplacement = this.integrate(forceNodes, velocityDecay, width, height, previousPositions);
            // Node-Edge-Abstoßung (verhinder Node-Edge-Overlap)
            this.applyNodeEdgeAvoidanceForce(forceNodes, links, collideRadius, edgePadding, edgeAvoidStrength, alpha);
            // 3a) erste/letzte Place leicht an die Notationsränder ziehen
            this.applyFlowDirectionForce(forceNodes, {
                leftPlaceId,
                rightPlaceId,
                minX,
                maxX,
                strength: horizontalOrientationStrength,
                alpha
            });
            // 4) Kollisionserkennung -> löst Overlapping der Nodes
            this.applyCollisionForce(forceNodes, collideRadius, alpha);
            for (let k = 0; k < forceNodes.length; k++) {
                previousPositions[k].x = forceNodes[k].x;
                previousPositions[k].y = forceNodes[k].y;
            }
            // Bewegung der Nodes wird mit der Zeit kleiner
            alpha += (alphaTarget - alpha) * alphaDecay;
            // 6) nach jedem Tick werden Zwischstände gecaptured -> für Animation in der Display-Component
            this.captureFrame({iteration: i + 1, nodes: forceNodes, onIteration, frames, maxDisplacement, mapToTarget}); // changed
            // Grundlage ist die größte Distanz, die ein Node in diesem Tick zurückgelegt hat.
            stationaryTicks = maxDisplacement < movementEpsilon ? stationaryTicks + 1 : 0;
            if (stationaryTicks >= stationaryTicksRequired) {
                break;
            }
        }

        // 7) die berechneten Koordinaten werden auf die echten Diagram-Nodes übertragen
        for (const node of nodes) {
            const state = forceNodes.find(fn => fn.id === node.id)!;
            const mapped = mapToTarget(state.x, state.y);
            node.setX(mapped.x);
            node.setY(mapped.y);
        }
        // Falls Frame-Array übergeben wurde, wird das Ergebnis dort gespeichert, damit es später in Display Componen animiert werden kann
        if (frames) {
            diagram.layoutFrames = frames;
        }

        return diagram;
    }

    // Cleans up Waypoints in order to ignore (imported) anchor points for layouting
    private cleanUpWaypoints(diagram: Diagram) {
        diagram.edges.forEach((edge) => {
            edge.waypoints.set([]);
        });
    }

    private captureFrame({
        iteration,
        nodes,
        onIteration,
        frames,
        maxDisplacement,
        mapToTarget
    }: {
        iteration: number;
        nodes: ForceNode[];
        onIteration?: (iteration: number, positions: Array<{id: string; x: number; y: number}>) => void;
        frames?: LayoutFrame[];
        maxDisplacement?: number;
        mapToTarget?: (x: number, y: number) => {x: number; y: number};
    }) {
        // Jeder Frame speichert genauem Positionswerte
        const snapshot = nodes.map(n => {
            if (!mapToTarget) {
                return {id: n.id, x: n.x, y: n.y};
            }
            const mapped = mapToTarget(n.x, n.y);
            return {id: n.id, x: mapped.x, y: mapped.y};
        });
        onIteration?.(iteration, snapshot);
        frames?.push({iteration, positions: snapshot, maxDisplacement});
    }


    /** Ausgangspositionen werden auf einem Kreis (plus Jitter) verteilt, damit der Sovler schnell zu stabilem Zustand konvergiert
     * und keine Nodes übereinanderliegen
     * = Methode erzeugt die interne Repräsentation ForceNodes mit zusätzlicher Geschwindigkeit
     */
    // eslint-disable-next-line max-params
    private initializeForceNodes(
        nodes: IDiagramNode[],
        width: number,
        height: number,
        random: () => number,
        targetWidth: number,
        targetHeight: number
    ): ForceNode[] {
        const min = 65;
        const maxX = width - min;
        const maxY = height - min;

        // Fallback-Kreis (wie bisher), aber nur wenn Node keine Koordinaten hat
        const radius = Math.min(width, height) / 3;
        const centerX = width / 2;
        const centerY = height / 2;
        const jitter = 0.35 * radius;

        return nodes.map((node, index) => {
            const existingX = node.x();
            const existingY = node.y();

            const hasExisting =
                Number.isFinite(existingX) &&
                Number.isFinite(existingY) &&
                !(existingX === 0 && existingY === 0);

            let x: number;
            let y: number;

            if (hasExisting) {
                // Bestehende Koordinaten verwenden, aber in Bounds clampen
                // WICHTIG: existingX/existingY sind im Target-Koordinatensystem -> in Simulationsraum umrechnen
                const margin = 65;

                const simMinX = margin;
                const simMaxX = width - margin;
                const simMinY = margin;
                const simMaxY = height - margin;

                const tgtMinX = margin;
                const tgtMaxX = targetWidth - margin;
                const tgtMinY = margin;
                const tgtMaxY = targetHeight - margin;

                const sx = (simMaxX - simMinX) / ((tgtMaxX - tgtMinX) || 0.0001);
                const sy = (simMaxY - simMinY) / ((tgtMaxY - tgtMinY) || 0.0001);

                x = simMinX + (existingX - tgtMinX) * sx;
                y = simMinY + (existingY - tgtMinY) * sy;

                x = this.clamp(x, simMinX, simMaxX);
                y = this.clamp(y, simMinY, simMaxY);
            } else {
                // Fallback: Kreis + Jitter
                const angle = (2 * Math.PI * index) / Math.max(nodes.length, 1);
                x = centerX + radius * Math.cos(angle) + this.randomOffset(jitter, random);
                y = centerY + radius * Math.sin(angle) + this.randomOffset(jitter, random);

                x = this.clamp(x, min, maxX);
                y = this.clamp(y, min, maxY);
            }

            return {id: node.id, x, y, vx: 0, vy: 0};
        });
    }

    private applyLinkForce(nodes: ForceNode[], links: Array<{source: string; target: string}>, distance: number, alpha: number) {
        // Hält verbundene Nodes in einer Ziel-Distanz "Feder"/Spring:
        // falls tatsächliche Distanz größer als 'distance' -> pull nodes togheter
        // else -> push
        const nodeById = new Map(nodes.map(n => [n.id, n]));
        const strength = 1.1; // Federstärke
        for (const link of links) {
            const source = nodeById.get(link.source); // Startknoten
            const target = nodeById.get(link.target); // Endknoten
            if (!source || !target) {
                continue;
            }
            // Richtung und Länge der aktuellen Kanten ermitteln
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            // Verhindert Division durch 0
            const len = Math.hypot(dx, dy) || 0.0001;
            // Hooke'sches Gesetz: Kraft proportional zur Abweichung vom Soll-Abstand
            const force = (len - distance) * strength * alpha;
            // Force-Anteil in x-Richtung
            const fx = (dx / len) * force;
            // Force-Anteil in y-Richtung
            const fy = (dy / len) * force;
            // Geschwindigkeiten beider Endpunkte werden entgegengesetzte, damit Schwerpunkt erhalten bleibt
            source.vx += fx;
            source.vy += fy;
            target.vx -= fx;
            target.vy -= fy;
        }
    }

    /**
     * Modelliert eine "elektrische Abstoßung" (Inverse Quadratgesetz)
     * Dadurch sammeln sich die Nodes nicht in der Mitte, sondern gleichmäßige Verteilung
     * chargeStrength ist negativ, daher resultiert die abstoßende Kraft
     */
    private applyManyBodyForce(nodes: ForceNode[], chargeStrength: number, alpha: number) {
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i];
                const b = nodes[j];
                // Differenzvektor & quadrierte Distanz
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist2 = dx * dx + dy * dy || 0.0001; // Vermeidet Division durch 0
                // Abstoßung nimmt quadratisch mit Entferung ab (Coulomb-Abstoßung)
                const force = (chargeStrength * alpha) / dist2;
                const fx = dx * force;
                const fy = dy * force;
                // Repulsion: negative chargeStrength pushes nodes auseinander. Mit add/sub statt
                // vertauschter Richtung wie zuvor, damit gleichnamige Ladungen korrekt trennen.
                a.vx += fx;
                a.vy += fy;
                b.vx -= fx;
                b.vy -= fy;
            }
        }
    }

    private applyFlowDirectionForce(
        nodes: ForceNode[],
        {leftPlaceId, rightPlaceId, minX, maxX, strength, alpha}: {
            leftPlaceId: string | undefined; rightPlaceId: string | undefined; minX: number; maxX: number; strength: number; alpha: number;
        }
    ) {
        if (!leftPlaceId || !rightPlaceId || leftPlaceId === rightPlaceId || nodes.length === 0) {
            return;
        }
        const nodeById = new Map(nodes.map(node => [node.id, node]));
        const leftNode = nodeById.get(leftPlaceId);
        const rightNode = nodeById.get(rightPlaceId);
        if (leftNode) {
            leftNode.vx += (minX - leftNode.x) * strength * alpha;
        }
        if (rightNode) {
            rightNode.vx += (maxX - rightNode.x) * strength * alpha;
        }
    }

    private applyCenterForce(nodes: ForceNode[], cx: number, cy: number, strength: number, alpha: number) {
        for (const node of nodes) {
            node.vx += (cx - node.x) * strength * alpha;
            node.vy += (cy - node.y) * strength * alpha;
        }
    }

    private applyCollisionForce(nodes: ForceNode[], radius: number, alpha: number) {
        // min-Abstant zwischen zwei Nodes
        const minDist = radius * 2;
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i];
                const b = nodes[j];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.hypot(dx, dy) || 0.0001;
                if (dist >= minDist) {
                    continue;
                }
                // Verhältnis, um wie viel beide Knoten voneinander wegrücken müssen
                const overlap = ((minDist - dist) / dist) * 0.5 * alpha;
                const fx = dx * overlap;
                const fy = dy * overlap;

                // Positionsanpassung direkt an x/y, damit Überlappung sofort korrigiert wird (nicht erst im Integration-Schritt)
                a.x -= fx;
                a.y -= fy;
                b.x += fx;
                b.y += fy;
            }
        }
    }

    // eslint-disable-next-line max-params
    private applyNodeEdgeAvoidanceForce(
        nodes: ForceNode[],
        links: Array<{source: string; target: string}>,
        nodeRadius: number,
        edgePadding: number,
        strength: number,
        alpha: number
    ) {
        if (nodes.length === 0 || links.length === 0) {
            return;
        }
        const nodeById = new Map(nodes.map(node => [node.id, node]));
        const minDist = nodeRadius + edgePadding;
        for (const link of links) {
            const a = nodeById.get(link.source);
            const b = nodeById.get(link.target);
            if (!a || !b) {
                continue;
            }

            const ax = a.x;
            const ay = a.y;
            const bx = b.x;
            const by = b.y;

            const abx = bx - ax;
            const aby = by - ay;
            const abLen2 = abx * abx + aby * aby || 0.0001;

            for (const n of nodes) {
                // nicht gegen eigene Kante "kämpfen"
                if (n.id === a.id || n.id === b.id) {
                    continue;
                }
                // Projektion: Nächster Punkt auf Segment AB
                const apx = n.x - ax;
                const apy = n.y - ay;
                let t = (apx * abx + apy * aby) / abLen2;
                t = Math.max(0, Math.min(1, t));

                const closestX = ax + t * abx;
                const closestY = ay + t * aby;

                const dx = n.x - closestX;
                const dy = n.y - closestY;
                const dist = Math.hypot(dx, dy) || 0.0001;

                if (dist >= minDist) {
                    continue;
                }
                // Abstand zur Kante ist zu klein → horizontal wegschieben
                const overlap = (minDist - dist) / dist;

                // Vorzeichen entscheidet, ob nach links oder rechts
                const signX = dx === 0 ? 0 : Math.sign(dx);

                // Nur horizontale Kraft
                const fx = signX * overlap * strength * alpha;

                n.vx += fx;
                // n.vy bleibt unverändert
            }
        }
    }

    /**
     * Wendet die resultierenden Geschwindigkeiten auf die Positionen an (Velet-argtige Integration)
     * und dämpft die Bewegung.
     * Gleichzeitig Sicherstellung, dass Nodes innerhalb der Zeichenfläche bleiben
     */
    private integrate(
        nodes: ForceNode[],
        velocityDecay: number,
        width: number,
        height: number,
        previousPositions: Array<{x: number; y: number}>
    ): number {
        const min = 65;
        const maxX = width - min;
        const maxY = height - min;
        let maxDisplacement = 0;
        for (let index = 0; index < nodes.length; index++) {
            const node = nodes[index];
            // Geschwindigkeit dämpfen (exponentielle Abklingzeit)
            node.vx *= 1 - velocityDecay;
            node.vy *= 1 - velocityDecay;
            // Positionen anpassen um auf den Zeichenbereich zu beschränken
            const nextX = this.clamp(node.x + node.vx, min, maxX);
            const nextY = this.clamp(node.y + node.vy, min, maxY);
            const dx = nextX - previousPositions[index].x;
            const dy = nextY - previousPositions[index].y;
            maxDisplacement = Math.max(maxDisplacement, Math.hypot(dx, dy));
            node.x = nextX;
            node.y = nextY;
            previousPositions[index].x = nextX;
            previousPositions[index].y = nextY;
        }
        return maxDisplacement;
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }

    // Liefert symmetrischen Zufallswert im Intervall
    private randomOffset(range: number, random: () => number): number {
        return (random() * 2 - 1) * range;
    }


    /** Einfache, deterministische LCG, damit identische Eingaben immer das
     * gleiche Layout erzeugen (relevant für Tests und reproduzierbare Animation
     */
    private createRandomGenerator(seed: number): () => number {
        let state = seed || 1;
        return () => {
            state = (1664525 * state + 1013904223) % 4294967296;
            return state / 4294967296;
        };
    }

    /**
     * FNV-ähnlicher Hash (einfach, gute Performance)
     * über alle IDs als Default-Seed. Dadurch ändert sich der Startzustand,
     * sobald sich die Knotenmenge ändert, bleibt aber bei identischer Menge stabil.
     */
    private hashNodeIds(nodes: IDiagramNode[]): number {
        let hash = 2166136261;
        for (const node of nodes) {
            for (let i = 0; i < node.id.length; i++) {
                hash ^= node.id.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
        }
        return hash >>> 0;
    }

}
