import {Injectable} from '@angular/core';
import {Diagram} from 'src/app/classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {DiagramHint, IDiagramNode, ProcessNet} from '../../classes/diagram/diagram-types';
import {applyValidityToProcessNet, findReachableSequence, getStartMarking, isTransitionEnabled} from './process-net-utils';

@Injectable({
    providedIn: 'root'
})
export class ProcessNetGeneratorService {

    generateInitialProcessNet(petriNet: Diagram): Diagram<DiagramNode> {
        const startMarking = getStartMarking(petriNet);
        const conditions: DiagramNode[] = [];
        let conditionCounter = 0;

        for (const [placeLabel, requiredCount] of startMarking) {
            for (let k = 0; k < requiredCount; k++) {
                conditionCounter++;
                const conditionId = `b${conditionCounter}`;
                const condition = new DiagramNode(conditionId, 'place');
                condition.setLabel(placeLabel);

                conditions.push(condition);
            }
        }
        const diagram = new Diagram(conditions, []);
        diagram.applySimpleLayout();
        applyValidityToProcessNet(diagram, new Map(), new Map());
        return diagram;
    }

    /**
     * Generiert ein vollständiges und valides Prozessnetz aus einem Petrinetz
     * Basierend auf dem Algorithmus aus dem Pseudocode (Zeilen 00-32)
     */
    generateProcessNet(petriNet: Diagram, mandatoryTransitions: string[], exactSequence: boolean = false): ProcessNet {
        // Wenn verpflichtende Transitionen angegeben sind, finde Pfad für diese
        let targetSequence: string[] = [];
        if (mandatoryTransitions.length > 0) {
            targetSequence = exactSequence ? mandatoryTransitions : findReachableSequence(petriNet, mandatoryTransitions);
        }

        const startMarking = getStartMarking(petriNet);

        // B, E, F, l, M, M' ← ∅ (Zeile 01)
        const conditions: DiagramNode[] = [];
        const events: DiagramNode[] = [];
        const edges: DiagramEdge<DiagramNode>[] = [];
        const labelMap = new Map<string, string>(); // Maps condition/event id to place/transition label

        let conditionCounter = 0; // i ← 0 (Zeile 02)
        let eventCounter = 0; // j ← 0 (Zeile 02)

        let sequenceIndex = 0; // Index für die Ziel-Schaltsequenz

        // FOREACH p ∈ m0 DO (Zeilen 03-09)
        for (const [placeLabel, requiredCount] of startMarking) {
            for (let k = 0; k < requiredCount; k++) {
                conditionCounter++; // i ← i + 1 (Zeile 04)
                const conditionId = `b${conditionCounter}`;
                const condition = new DiagramNode(conditionId, 'place'); // B ← B ∪ bi (Zeile 05)

                labelMap.set(conditionId, placeLabel); // l(bi) ← p (Zeile 06)
                conditions.push(condition);
                // M ← M ∪ bi (Zeile 07) - wird über freeConditions in der Schleife ermittelt
            }
        }

        // Hauptschleife: Wähle schaltbare Transitionen und füge Ereignisse hinzu (Zeilen 10-31)
        const MAX_ITERATIONS = 50;
        let iterations = 0;
        const visitedMarkings = new Set<string>();
        let loopDetected = false;

        while (iterations < MAX_ITERATIONS) {
            iterations++;

            // Finde eine schaltbare Transition (Zeile 11: IF THERE IS CHOOSE t ∈ T, l(M) ≥ •t)
            // Erstelle Markierung aus den "freien" Bedingungen
            const freeConditions = conditions.filter(c =>
                !edges.some(e => e.source.id === c.id && events.some(ev => ev.id === e.target.id)));

            const marking = new Map<string, number>();
            for (const condition of freeConditions) {
                const label = labelMap.get(condition.id)!;
                marking.set(label, (marking.get(label) || 0) + 1);
            }

            // Loop detection: Prüfung, ob Markierung schon mal erreicht wurde
            const markingKey = Array.from(marking.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([k, v]) => `${k}:${v}`)
                .join(',');

            if (visitedMarkings.has(markingKey) && sequenceIndex >= targetSequence.length) {
                loopDetected = true;
                break;
            }
            visitedMarkings.add(markingKey);

            const transitions = petriNet.nodes.filter(n => n.kind === 'transition');

            // Priorisiere Transitionen aus der Wunsch-Schaltsequenz
            let enabledTransition: IDiagramNode | null = null;

            if (sequenceIndex < targetSequence.length) {
                const nextTarget = targetSequence[sequenceIndex];
                const targetTransition = transitions.find(t => t.effectiveLabel() === nextTarget);

                if (targetTransition && isTransitionEnabled(targetTransition, marking, petriNet)) {
                    enabledTransition = targetTransition;
                    sequenceIndex++;
                }
            }

            // Falls keine verpflichtende Transition gefunden wurde, nimm irgendeine, wenn...
            // ...nur wenn keine verpflichtende Transition angegeben wurde
            // ...oder exactSequence nicht gestzt
            if (!enabledTransition && !exactSequence && targetSequence.length === 0) {
                for (const transition of transitions) {
                    if (isTransitionEnabled(transition, marking, petriNet)) {
                        enabledTransition = transition;
                        break;
                    }
                }
            }

            // Wenn die angegebene Schaltsequenz vollständig abgearbeitet wurde ist die Generierung fertig
            if (!enabledTransition && targetSequence.length > 0 && sequenceIndex >= targetSequence.length) {
                break;
            }

            if (!enabledTransition) {
                // Keine Transition mehr schaltbar → Springe zu Zeile 32 (OUTPUT)
                break;
            }

            eventCounter++; // j ← j + 1 (Zeile 12)
            const eventId = `e${eventCounter}`;
            const newEvent = new DiagramNode(eventId, 'transition'); // E ← E ∪ ej (Zeile 13)
            const transitionLabel = enabledTransition.effectiveLabel();

            labelMap.set(eventId, transitionLabel);
            events.push(newEvent);

            // M' ← •t (Zeile 14)
            const preconditions = petriNet.getRelated(enabledTransition, 'in');

            // FOREACH p ∈ M' DO (Zeilen 15-20)
            for (const condition of preconditions) {
                const preLabel = condition.effectiveLabel();
                const edge = petriNet.findEdgeByEffectiveLabel(preLabel, transitionLabel);
                const weight = edge?.weight() || 1;

                for (let k = 0; k < weight; k++) {
                    // CHOOSE b ∈ M, l(b) = p (Zeile 16)
                    // Finde eine freie Bedingung mit dem passenden Label
                    const chosenCondition = freeConditions.find(c => labelMap.get(c.id) === preLabel);

                    if (!chosenCondition) {
                        console.error(`No free condition available for ${preLabel}`);
                        continue;
                    }

                    // F ← F + (b, ej) (Zeile 17)
                    edges.push(new DiagramEdge(chosenCondition, newEvent));

                    // M ← M − b (Zeile 18)
                    // Entferne aus freeConditions (wird jetzt konsumiert)
                    const index = freeConditions.indexOf(chosenCondition);
                    if (index > -1) {
                        freeConditions.splice(index, 1);
                    }
                }
            }

            // M' ← t• (Zeile 21)
            const postconditions = petriNet.getRelated(enabledTransition, 'out');

            // FOREACH p ∈ M' DO (Zeilen 22-29)
            for (const condition of postconditions) {
                const postLabel = condition.effectiveLabel();
                const edge = petriNet.findEdgeByEffectiveLabel(transitionLabel, postLabel);
                const weight = edge?.weight() || 1;

                for (let k = 0; k < weight; k++) {
                    conditionCounter++; // i ← i + 1 (Zeile 23)
                    const conditionId = `b${conditionCounter}`;
                    const newCondition = new DiagramNode(conditionId, 'place'); // B ← B ∪ bi (Zeile 24)

                    labelMap.set(conditionId, postLabel); // l(bi) ← p (Zeile 25)
                    conditions.push(newCondition);

                    // F ← F + (ej, bi) (Zeile 26)
                    edges.push(new DiagramEdge(newEvent, newCondition));

                    // M ← M ∪ bi (Zeile 27) - Neue Bedingung ist automatisch "frei"
                }
            }

            // JUMP TO LINE 10 (Zeile 31)
        }

        // Warnung, wenn Iterationsgrenze erreicht wurde oder Loop erkannt
        let diagramHint: DiagramHint | undefined;
        if (iterations >= MAX_ITERATIONS || loopDetected) {
            const reason = loopDetected ? 'loop detection' : 'iteration limit';
            console.warn(`Abort generation due to ${reason}`);

            diagramHint = {
                message: loopDetected
                    ? 'Process net generation stopped because a loop was detected (state repeated).'
                    : `Process net generation stopped after ${MAX_ITERATIONS} steps to prevent infinite growth.`
            };

            // Markiere freie Bedingungen
            const freeConditions = conditions.filter(c =>
                !edges.some(e => e.source.id === c.id));

            for (const condition of freeConditions) {
                condition.setValidity({status: 'partly-valid', reasons: [`Last condition due to ${reason}`]});
            }
        }

        // OUTPUT (B, E, F) AND l (Zeile 32)
        // Setze Labels für alle Knoten
        for (const condition of conditions) {
            const label = labelMap.get(condition.id);
            if (label) {
                condition.setLabel(label);
            }
        }

        for (const event of events) {
            const label = labelMap.get(event.id);
            if (label) {
                event.setLabel(label);
            }
        }

        // Erstelle Diagram mit allen Knoten und Kanten
        const allNodes: DiagramNode[] = [...conditions, ...events];
        const diagram = new Diagram(allNodes, edges);
        if (diagramHint) {
            diagram.hint = diagramHint;
        }
        diagram.applySimpleLayout();
        applyValidityToProcessNet(diagram, new Map(), new Map());
        return diagram;
    }

}
