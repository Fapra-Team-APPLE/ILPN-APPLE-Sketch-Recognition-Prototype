import {inject, Injectable} from '@angular/core';
import {Diagram} from '../../classes/diagram/diagram';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {DiagramValidity} from '../../classes/diagram/diagram-types';
import {ReachabilityEdge} from '../../classes/reachability/reachability-edge';
import {ReachabilityGraph} from '../../classes/reachability/reachability-graph';
import {Marking} from '../../classes/reachability/reachability-node';
import {ReachabilityGraphGeneratorService} from './reachability-graph-generator.service';
import {ReachabilityService} from './reachability.service';

type ReachabilityGraphValidationErrorMessage = string;

@Injectable({
    providedIn: 'root'
})
export class ReachabilityValidationService {

    private readonly reachabilityService = inject(ReachabilityService);
    private readonly generator = inject(ReachabilityGraphGeneratorService);

    validateReachabilityGraph(userGraph: ReachabilityGraph, petriNet: Diagram<DiagramNode>): ReachabilityGraphValidationErrorMessage | null {
        const placeIds = this.reachabilityService.getPlaceIds(petriNet);

        if (placeIds.length === 0) return 'The Petri net contains no places and cannot be validated.';
        if (userGraph.nodes.length === 0) return 'The reachability graph contains no states.';

        const nodeValidityMap = new Map<string, DiagramValidity>();
        const nodeMarkingValidityMap = new Map<string, Record<string, DiagramValidity>>();
        const edgeValidityMap = new Map<ReachabilityEdge, DiagramValidity>();

        let firstError: string | null = null;
        const setError = (error: string) => {
            if (!firstError) firstError = error;
        };

        // 1. Initialzustand prüfen
        const initialNode = this.reachabilityService.findInitialNode(userGraph);
        if (!initialNode) return 'The reachability graph has no initial state.';

        const expectedInitial = this.reachabilityService.buildInitialMarking(petriNet, placeIds);
        const {valid: initialNodeValid, markingValidity: initialMarkingValidity} =
            this.reachabilityService.validateNodeMarking(initialNode, [expectedInitial], placeIds);

        nodeMarkingValidityMap.set(initialNode.id, initialMarkingValidity);

        if (!initialNodeValid) {
            nodeValidityMap.set(initialNode.id, {
                status: 'invalid',
                reasons: ['Initial state marking does not match the Petri net marking.']
            });
            setError('The initial marking of the reachability graph does not match the marking of the Petri net.');
        } else {
            nodeValidityMap.set(initialNode.id, {status: 'valid'});
        }

        // 2. Lösung berechnen & Index für Vollständigkeitsprüfung erstellen
        const solutionGraph = this.generator.generateReachabilityGraph(petriNet, { coverability: true });
        const solutionMarkingMap = new Map<string, Marking[]>();
        const expectedOutgoing = new Map<string, Set<string>>();
        const expectedIncoming = new Map<string, Set<string>>();

        const getEdgeSig = (label: string, otherKey: string) => `${label.trim()}|${otherKey}`;

        for (const node of solutionGraph.nodes) {
            const markingKey = this.reachabilityService.markingKey(node.marking(), placeIds);
            if (!solutionMarkingMap.has(markingKey)) {
                solutionMarkingMap.set(markingKey, []);
                expectedOutgoing.set(markingKey, new Set());
                expectedIncoming.set(markingKey, new Set());
            }
            solutionMarkingMap.get(markingKey)!.push(node.marking());
        }

        for (const edge of solutionGraph.edges) {
            const sMarkingKey = this.reachabilityService.markingKey(edge.source.marking(), placeIds);
            const tMarkingKey = this.reachabilityService.markingKey(edge.target.marking(), placeIds);
            const label = edge.label() ?? '';

            expectedOutgoing.get(sMarkingKey)?.add(getEdgeSig(label, tMarkingKey));
            expectedIncoming.get(tMarkingKey)?.add(getEdgeSig(label, sMarkingKey));
        }

        // 3. User-Struktur mappen
        const userOutgoing = new Map<string, ReachabilityEdge[]>();
        const userIncoming = new Map<string, ReachabilityEdge[]>();

        for (const node of userGraph.nodes) {
            userOutgoing.set(node.id, []);
            userIncoming.set(node.id, []);
        }

        for (const edge of userGraph.edges) {
            userOutgoing.get(edge.source.id)?.push(edge);
            userIncoming.get(edge.target.id)?.push(edge);
        }

        // --- 4. Knoten Validierung (Vollständigkeit) ---
        const seenMarkings = new Set<string>();

        for (const node of userGraph.nodes) {
            const mKey = this.reachabilityService.markingKey(node.marking(), placeIds);
            const expected = solutionMarkingMap.get(mKey);
            const reasons: string[] = [];

            // Fall A: Markierung existiert nicht exakt in der Lösung
            if (!expected) {
                // Versuchen die erwartete Markierung aus den eingehenden Kanten herzuleiten für node marking validity
                let bestMatchValidity: Record<string, DiagramValidity> | undefined;
                let maxMatchCount = -1;
                let bestMatchReasons: string[] = [];

                const incomingEdges = userIncoming.get(node.id) ?? [];
                for (const edge of incomingEdges) {
                    const sourceMarkingKey = this.reachabilityService.markingKey(edge.source.marking(), placeIds);
                    if (solutionMarkingMap.has(sourceMarkingKey)) {
                        const validOutgoingEdgeSignatures = expectedOutgoing.get(sourceMarkingKey);
                        const label = edge.label()?.trim() ?? '';
                        const prefix = label + '|';

                        if (validOutgoingEdgeSignatures) {
                            for (const outgoingEdgeSignature of validOutgoingEdgeSignatures) {
                                if (outgoingEdgeSignature.startsWith(prefix)) {
                                    const targetMarkingKey = outgoingEdgeSignature.substring(prefix.length);
                                    const candidates = solutionMarkingMap.get(targetMarkingKey);
                                    if (candidates && candidates.length > 0) {
                                        const result = this.reachabilityService.validateNodeMarking(node, [candidates[0]], placeIds);
                                        const matchCount = Object.values(result.markingValidity).filter(v => v?.status === 'valid').length;

                                        if (matchCount > maxMatchCount) {
                                            maxMatchCount = matchCount;
                                            bestMatchValidity = result.markingValidity;
                                            bestMatchReasons = [`Marking does not match the expected marking after firing transition "${label}".`];
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (bestMatchValidity) {
                    nodeMarkingValidityMap.set(node.id, bestMatchValidity);
                    nodeValidityMap.set(node.id, {
                        status: 'invalid',
                        reasons: bestMatchReasons
                    });
                } else {
                    nodeValidityMap.set(node.id, {
                        status: 'invalid',
                        reasons: ['State marking does not exist in the correct reachability graph.']
                    });
                }
                setError(`State ${node.id} has an invalid marking.`);
                continue;
            }

            // Fall B: Markierung ist existiert, wir prüfen auf Duplikate und Kanten
            let isDuplicate = false;
            if (seenMarkings.has(mKey)) {
                reasons.push('Duplicate marking detected: another state has the same marking.');
                isDuplicate = true;
            } else {
                seenMarkings.add(mKey);
            }

            // Kanten-Vollständigkeit prüfen
            const expOut = expectedOutgoing.get(mKey) ?? new Set();
            const actOut = new Set((userOutgoing.get(node.id) ?? []).map(e =>
                getEdgeSig(e.label() ?? '', this.reachabilityService.markingKey(e.target.marking(), placeIds))));

            let missingOut = false;
            for (const sig of expOut) {
                if (!actOut.has(sig)) {
                    // Prüfen, ob das Label existiert aber auf ein falsches Ziel zeigt
                    const label = sig.split('|')[0];
                    const userEdges = userOutgoing.get(node.id) ?? [];
                    const transitionExists = userEdges.some(e => (e.label() ?? '').trim() === label);

                    // Nur wenn die Transition gar nicht existiert, den Fehler auf Knoten-Ebene melden.
                    // Wenn sie existiert (aber falsch ist), wird das durch die Kanten-Validierung abgedeckt.
                    if (!transitionExists) {
                        reasons.push(`Missing outgoing transition: "${label}"`);
                        missingOut = true;
                    }
                }
            }

            let missingIn = false;
            const expIn = expectedIncoming.get(mKey) ?? new Set();
            const actIn = new Set((userIncoming.get(node.id) ?? []).map(e =>
                getEdgeSig(e.label() ?? '', this.reachabilityService.markingKey(e.source.marking(), placeIds))));

            for (const sig of expIn) {
                if (!actIn.has(sig)) {
                    const label = sig.split('|')[0];
                    const userEdges = userIncoming.get(node.id) ?? [];
                    const transitionExists = userEdges.some(e => (e.label() ?? '').trim() === label);

                    if (!transitionExists) {
                        reasons.push(`Missing ingoing transition: "${label}"`);
                        missingIn = true;
                    }
                }
            }

            // --- Status Vergabe ---
            if (isDuplicate) {
                nodeValidityMap.set(node.id, { status: 'invalid', reasons });
                setError('Duplicate states found. Each marking must be unique.');
            } else if (missingOut || missingIn) {
                nodeValidityMap.set(node.id, { status: 'partly-valid', reasons });
                setError('Some states have missing transitions. Check for enabled transitions that are not drawn.');
            } else {
                nodeValidityMap.set(node.id, { status: 'valid' });
            }
        }

        // --- 5. Kanten-Validierung ---
        const seenSourceTransition = new Set<string>();

        for (const edge of userGraph.edges) {
            const sKey = this.reachabilityService.markingKey(edge.source.marking(), placeIds);
            const label = edge.label()?.trim() ?? '';

            const duplicateKey = `${edge.source.id}|${label}`;
            if (seenSourceTransition.has(duplicateKey)) {
                edgeValidityMap.set(edge, {
                    status: 'invalid',
                    reasons: ['This transition has already been drawn from this state.']
                });
                setError(`Duplicate transition "${label}" from state ${edge.source.id}.`);
                continue;
            }
            seenSourceTransition.add(duplicateKey);

            const validSignatures = expectedOutgoing.get(sKey);

            if (!validSignatures) {
                edgeValidityMap.set(edge, {
                    status: 'invalid',
                    reasons: [`The source state ${edge.source.id} is not part of the solution.`]
                });
                continue;
            }

            const targetKey = this.reachabilityService.markingKey(edge.target.marking(), placeIds);
            const currentSignature = getEdgeSig(label, targetKey);

            if (validSignatures.has(currentSignature)) {
                edgeValidityMap.set(edge, {status: 'valid'});
            } else {
                const transitionActive = Array.from(validSignatures).some(sig => sig.startsWith(label + '|'));

                if (transitionActive) {
                    edgeValidityMap.set(edge, {
                        status: 'invalid',
                        reasons: [`The transition "${label}" leads to a state with an incorrect marking.`]
                    });
                    setError(`Transition "${label}" leads to an incorrect state. Check the target marking.`);
                } else {
                    edgeValidityMap.set(edge, {
                        status: 'invalid',
                        reasons: [`The transition "${label}" is not active in the state ${edge.source.id}.`]
                    });
                    setError(`Transition "${label}" is not enabled in state ${edge.source.id}.`);
                }
            }
        }

        this.reachabilityService.applyValidity(userGraph, nodeValidityMap, nodeMarkingValidityMap, edgeValidityMap);
        return firstError;
    }

}
