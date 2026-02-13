import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {DiagramValidity, IDiagramNode} from '../../classes/diagram/diagram-types';

export type ProcessNetValidationStatus = 'valid-complete' | 'valid-incomplete' | 'invalid' | 'valid';

export interface ProcessNetValidationResult {
    status: ProcessNetValidationStatus;
    message?: string;
    hint?: string;
}

/**
 * Die Anfangsmarkierung ergibt sich aus der Markenanzahl der Stellen
 * Datenstruktur-Vorschlag: Anfangsmarkierung beim Parsen in die Diagram-Klasse übernehmen
 */
export function getStartMarking(diagram: Diagram): Map<string, number> {
    const startMarking = new Map<string, number>();
    for (const node of diagram.nodes) {
        if (node.kind === 'place' && node instanceof DiagramNode) {
            // startMarking.set(node.id, node.tokenCount);

            startMarking.set(node.effectiveLabel(), node.tokenCount);
        }
    }
    return startMarking;
}

/**
 * Prüft, ob eine Transition schaltbar ist bei gegebener Markierung
 */
export function isTransitionEnabled(transition: IDiagramNode, marking: Map<string, number>, petriNet: Diagram): boolean {
    const transitionLabel = transition.effectiveLabel();
    const preconditions = petriNet.getRelated(transition, 'in');

    // Prüfe für jede Vorbedingung, ob genügend Marken vorhanden sind
    for (const condition of preconditions) {
        const preLabel = condition.effectiveLabel();
        const edge = petriNet.findEdgeByEffectiveLabel(preLabel, transitionLabel);
        const requiredTokens = edge?.weight() || 1;
        const availableTokens = marking.get(preLabel) || 0;

        if (availableTokens < requiredTokens) {
            return false;
        }
    }

    return true;
}

/**
 * Extrahiert eine linearisierte Schaltsequenz (Transition-Labels) aus einem Prozessnetz.
 * Da ein Prozessnetz eine Halbordnung darstellt, wird die Reihenfolge bei Nebenläufigkeit durch Sortieren der Knoten-IDs bestimmt.
 */
export function extractLinearizedSequence(processNet: Diagram): string[] {
    const sequence: string[] = [];
    const incomingEdgesCount = new Map<string, number>();
    const adjacencyList = new Map<string, string[]>();

    // Initialisierung
    for (const node of processNet.nodes) {
        incomingEdgesCount.set(node.id, 0);
        adjacencyList.set(node.id, []);
    }

    // Graph aufbauen
    for (const edge of processNet.edges) {
        const source = edge.source.id;
        const target = edge.target.id;
        adjacencyList.get(source)?.push(target);
        incomingEdgesCount.set(target, (incomingEdgesCount.get(target) || 0) + 1);
    }

    // Topologische Sortierung
    const queue: string[] = [];
    for (const [nodeId, count] of incomingEdgesCount) {
        if (count === 0) {
            queue.push(nodeId);
        }
    }

    queue.sort();

    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        const node = processNet.nodes.find(n => n.id === nodeId);

        if (node && node.kind === 'transition') {
            sequence.push(node.effectiveLabel());
        }

        const neighbors = adjacencyList.get(nodeId) || [];
        for (const neighborId of neighbors) {
            const currentCount = incomingEdgesCount.get(neighborId)! - 1;
            incomingEdgesCount.set(neighborId, currentCount);
            if (currentCount === 0) {
                queue.push(neighborId);
            }
        }
    }

    return sequence;
}

interface ReachableState {
    marking: Map<string, number>;
    sequence: string[];
    firedRequiredTransitions: Set<string>; // Set der bereits geschalteten verpflichtenden Transitionen
}

/**
 * Breitensuche, um alle schaltbaren Transitionen zu finden
 */
export function findReachableSequence(petriNet: Diagram, mandatoryTransitions: string[] = []): string[] {
    const MAX_STATES = 10000;

    const startMarking = getStartMarking(petriNet);
    const requiredTransitions = new Set(mandatoryTransitions);

    const queue: ReachableState[] = [];
    queue.push({
        marking: startMarking,
        sequence: [],
        firedRequiredTransitions: new Set()
    });

    const visited = new Set<string>();
    let statesExplored = 0;

    while (queue.length > 0 && statesExplored < MAX_STATES) {
        statesExplored++;
        const state = queue.shift()!;
        const firedRequiredTransitions = state.firedRequiredTransitions;

        // Wenn alle verpflichtenden Transitionen geschaltet wurden
        if (mandatoryTransitions.length > 0 && firedRequiredTransitions.size >= requiredTransitions.size) {
            return state.sequence;
        }

        // Bei verpflichtenden Transitionen müssen wir tracken, welche schon geschaltet wurden
        const stateKey = markingToString(state.marking) + '_' + Array.from(firedRequiredTransitions).sort().join(',');
        if (visited.has(stateKey)) {
            continue;
        }
        visited.add(stateKey);

        const transitions = petriNet.nodes.filter(n => n.kind === 'transition');

        // Finde alle schaltbaren Transitionen
        for (const transition of transitions) {
            if (!isTransitionEnabled(transition, state.marking, petriNet)) {
                continue;
            }
            const transitionLabel = transition.effectiveLabel();

            // Aktualisieren der geschalteten verpflichtenden Transitionen
            const newMarking = fireTransition(transition, state.marking, petriNet);
            const newSequence = [...state.sequence, transitionLabel];
            const newFiredRequiredTransitions = new Set(state.firedRequiredTransitions);
            if (requiredTransitions.has(transitionLabel)) {
                newFiredRequiredTransitions.add(transitionLabel);
            }

            // Und weiter geht's!
            queue.push({
                marking: newMarking,
                sequence: newSequence,
                firedRequiredTransitions: newFiredRequiredTransitions
            });
        }
    }

    return [];
}

/**
 * Schaltet eine Transition und berechnet die Folgemarkierung
 */
export function fireTransition(transition: IDiagramNode, marking: Map<string, number>, petriNet: Diagram): Map<string, number> {
    const newMarking = new Map(marking);
    const transitionLabel = transition.effectiveLabel();

    // -Vorbedingungen
    const preconditions = petriNet.getRelated(transition, 'in');
    for (const precondition of preconditions) {
        const placeLabel = precondition.effectiveLabel();
        const edge = petriNet.findEdgeByEffectiveLabel(placeLabel, transitionLabel);
        const weight = edge?.weight() || 1;

        const currentTokens = newMarking.get(placeLabel) || 0;
        const newTokens = currentTokens - weight;

        if (newTokens > 0) {
            newMarking.set(placeLabel, newTokens);
        } else {
            newMarking.delete(placeLabel);
        }
    }

    // +Nachbedingung
    const postconditions = petriNet.getRelated(transition, 'out');
    for (const postcondition of postconditions) {
        const placeLabel = postcondition.effectiveLabel();
        const edge = petriNet.findEdgeByEffectiveLabel(transitionLabel, placeLabel);
        const weight = edge?.weight() || 1;

        const currentTokens = newMarking.get(placeLabel) || 0;
        newMarking.set(placeLabel, currentTokens + weight);
    }

    return newMarking;
}

export function isSameMarking(marking1: Map<string, number>, marking2: Map<string, number>): boolean {
    const keys = new Set([...marking1.keys(), ...marking2.keys()]);

    for (const key of keys) {
        const val1 = marking1.get(key) || 0;
        const val2 = marking2.get(key) || 0;
        if (val1 !== val2) {
            return false;
        }
    }
    return true;
}

/**
 * Erstellt eine Markierung aus einer Liste von Knoten (z.B. für Prozessnetze, wo jeder Knoten eine Marke repräsentiert)
 */
export function getMarkingFromDiagramNodes(nodes: IDiagramNode[]): Map<string, number> {
    const marking = new Map<string, number>();
    for (const node of nodes) {
        const label = node.effectiveLabel();
        marking.set(label, (marking.get(label) || 0) + 1);
    }
    return marking;
}

export function markingToString(marking: Map<string, number>): string {
    return Array.from(marking.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([place, count]) => `${place}:${count}`)
        .join(',');
}

export function applyValidityToProcessNet(processNet: Diagram, nodeValidityMap: Map<string, DiagramValidity>, edgeValidityMap: Map<DiagramEdge, DiagramValidity>) {
    for (const node of processNet.nodes) {
        if (nodeValidityMap.has(node.id)) {
            node.setValidity(nodeValidityMap.get(node.id));
        } else {
            // Setze Standardgültigkeit auf 'valid'
            node.setValidity({status: 'valid'});
        }
    }
    for (const edge of processNet.edges) {
        if (edgeValidityMap.has(edge)) {
            edge.setValidity(edgeValidityMap.get(edge));
        } else {
            // Setze Standardgültigkeit auf 'valid'
            edge.setValidity({status: 'valid'});
        }
    }
}
