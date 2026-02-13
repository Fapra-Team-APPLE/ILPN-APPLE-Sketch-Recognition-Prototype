import { Injectable } from '@angular/core';
import { Diagram } from 'src/app/classes/diagram/diagram';
import { DiagramEdge } from 'src/app/classes/diagram/diagram-edge';
import { DiagramValidity } from 'src/app/classes/diagram/diagram-types';
import { applyValidityToProcessNet, findReachableSequence, getStartMarking, isTransitionEnabled, ProcessNetValidationResult } from './process-net-utils';

@Injectable({
    providedIn: 'root'
})
export class ProcessNetValidationService {

    validate(processNet: Diagram, petriNet: Diagram, mandatoryTransitions: string[] = []): ProcessNetValidationResult {
        const nodeValidityMap = new Map<string, DiagramValidity>();
        const edgeValidityMap = new Map<DiagramEdge, DiagramValidity>();

        let firstError: ProcessNetValidationResult | null = null;
        let hasStructuralError = false; // Trackt, ob ein struktureller Fehler (invalid) aufgetreten ist
        const hasMandatoryTransitions = mandatoryTransitions.length > 0;

        const setError = (error: ProcessNetValidationResult) => {
            if (!firstError) {
                firstError = error;
            }
            if (error.status === 'invalid') {
                hasStructuralError = true;
            }
        };

        // Anfangsmarkierung
        const startMarking = getStartMarking(petriNet);
        // const startTokens = Array.from(startMarking.values()).reduce((sum, count) => sum + count, 0);

        // Bedingungen (Stellen im Prozessnetz)
        // Ereignisse (Transitionen im Prozessnetz)
        const conditions = processNet.nodes.filter(n => n.kind === 'place');
        const events = processNet.nodes.filter(n => n.kind === 'transition');

        // Validierung 1: Für jede Bedingung im Prozessnetz
        for (const condition of conditions) {
            const nodeLabel = condition.effectiveLabel();
            const place = petriNet.findNodeByEffectiveLabel(nodeLabel, 'place');

            // Jede Bedingung muss einer Stelle im Petrinetz entsprechen
            if (!place) {
                const errorMessage = `Condition "${nodeLabel}" does not exist in the Petri net`;
                nodeValidityMap.set(condition.id, {
                    status: 'invalid',
                    reasons: [errorMessage]
                });
                setError({
                    status: 'invalid',
                    message: 'Check the label of your conditions',
                    hint: errorMessage
                });
            }

            // Jede Bedingung darf höchstens einmal konsumiert werden (max. eine ausgehende Kante)
            if (processNet.outgoingEdges(condition).length > 1) {
                /* eslint-disable-next-line max-len */
                const errorMessage = `Condition "${nodeLabel}" has multiple outgoing edges. In a process net, each condition may only be consumed once. Create multiple separate conditions with the same label instead.`;
                nodeValidityMap.set(condition.id, {
                    status: 'invalid',
                    reasons: [errorMessage]
                });
                for (const edge of processNet.outgoingEdges(condition)) {
                    edgeValidityMap.set(edge, {
                        status: 'invalid',
                        reasons: [errorMessage]
                    });
                }
                setError({
                    status: 'invalid',
                    message: 'Check the outgoing edges of your conditions',
                    hint: errorMessage
                });
            }
        }

        // Validierung 2: Anfangsbedingungen
        // Annahme: "Anfangsbedingungen" haben keine eingehende Kante von einem Ereignis, das können auch "isolierte" Bedingungen sein
        const startConditions = conditions.filter(c => {
            return !processNet.edges.some(e => e.target.id === c.id && e.source.kind === 'transition');
        });

        // Zähle alle "Anfangsbedingungen" pro Label (auch isolierte!)
        const startConditionsCount = new Map<string, number>();
        for (const condition of startConditions) {
            const nodeLabel = condition.effectiveLabel();
            startConditionsCount.set(nodeLabel, (startConditionsCount.get(nodeLabel) || 0) + 1);
        }

        // Prüfe, dass die Anfangsmarkierung vollständig im Prozessnetz vorhanden ist
        // Für jede Stelle mit Marken müssen mindestens so viele Anfangsbedingungen existieren
        for (const [placeLabel, requiredCount] of startMarking) {
            if (requiredCount === 0) {
                continue;
            }
            const actualCount = startConditionsCount.get(placeLabel) || 0;
            if (actualCount < requiredCount) {
                const missing = requiredCount - actualCount;
                const errorMessage = `Missing ${missing} condition${missing > 1 ? 's' : ''} for initial marking`;
                nodeValidityMap.set(placeLabel, {
                    status: 'invalid',
                    reasons: [errorMessage]
                });
                setError({
                    status: 'invalid',
                    message: 'Construct a condition for each mark in the initial marking of the Petri net',
                    hint: `Add ${missing} ${missing > 1 ? 'conditions' : 'condition'} for "${placeLabel}"`
                });
            }
        }

        // Validierung 3: Für jedes Ereignis im Prozessnetz
        for (const event of events) {
            const nodeId = event.id;
            const nodeLabel = event.effectiveLabel();
            const transition = petriNet.findNodeByEffectiveLabel(nodeLabel, 'transition');

            // Jedes Ereignis muss einer Transition im Petrinetz entsprechen
            if (!transition) {
                const errorMessage = `Event "${nodeLabel}" does not exist in the Petri net`;
                nodeValidityMap.set(event.id, {
                    status: 'invalid',
                    reasons: [errorMessage]
                });
                setError({
                    status: 'invalid',
                    message: 'Check the label of your events',
                    hint: errorMessage
                });
            } else {
                const preconditions = processNet.getRelated(event, 'in');
                const preconditionsCounts = new Map<string, number>();
                const petriNetPreconditions = petriNet.getRelated(transition, 'in');

                // Für jedes Ereignis müssen die Vorbedingungen der Transition im Petrinetz entsprechen
                for (const condition of preconditions) {
                    const preId = condition.id;
                    const preLabel = condition.effectiveLabel();

                    // Prüfe, ob Kante im Petrinetz existiert
                    if (!petriNet.hasEdgeByEffectiveLabel(preLabel, nodeLabel)) {
                        const errorMessage = `Check the preconditions of event "${nodeLabel}". The Petri net has no edge from "${preLabel}" to "${nodeLabel}"`;
                        nodeValidityMap.set(event.id, {
                            status: 'invalid',
                            reasons: [errorMessage]
                        });
                        nodeValidityMap.set(condition.id, {
                            status: 'invalid',
                            reasons: [errorMessage]
                        });
                        const processNetEdge = processNet.findEdgeById(preId, nodeId);
                        edgeValidityMap.set(processNetEdge!, {
                            status: 'invalid',
                            reasons: [errorMessage]
                        });
                        setError({
                            status: 'invalid',
                            message: 'Check the precondition edges of your events',
                            hint: errorMessage
                        });
                    }

                    preconditionsCounts.set(preLabel, (preconditionsCounts.get(preLabel) || 0) + 1);
                }

                // Prüfe, dass Anzahl der Vorbedingungen dem Kantengewicht entspricht
                for (const [preLabel, count] of preconditionsCounts) {
                    const edge = petriNet.findEdgeByEffectiveLabel(preLabel, nodeLabel);
                    const expectedWeight = edge?.weight() || 1;
                    if (count !== expectedWeight) {
                        /* eslint-disable-next-line max-len */
                        const errorMessage = `Check the preconditions of event "${nodeLabel}". It requires ${expectedWeight} ${expectedWeight > 1 ? 'preconditions' : 'precondition'} from "${preLabel}", but has "${count}"`;
                        nodeValidityMap.set(event.id, {
                            status: 'invalid',
                            reasons: [errorMessage]
                        });

                        const relevantPreconditions = preconditions.filter(p => p.effectiveLabel() === preLabel);
                        for (const pre of relevantPreconditions) {
                            const processNetEdge = processNet.findEdgeById(pre.id, nodeId);
                            if (processNetEdge) {
                                edgeValidityMap.set(processNetEdge, {
                                    status: 'partly-valid',
                                    reasons: [errorMessage]
                                });
                            }
                            nodeValidityMap.set(pre.id, {
                                status: 'partly-valid',
                                reasons: [errorMessage]
                            });
                        }

                        setError({
                            status: 'invalid',
                            message: 'Check the preconditions of your events',
                            hint: errorMessage
                        });
                    }
                }

                // Prüfe alle erwarteten Vorbedingungen aus dem Petrinetz
                // (auch wenn das Prozessnetz bereits einige Vorbedingungen hat, könnten andere fehlen)
                for (const condition of petriNetPreconditions) {
                    const preLabel = condition.effectiveLabel();
                    const edge = petriNet.findEdgeByEffectiveLabel(preLabel, nodeLabel);
                    const expectedWeight = edge?.weight() || 1;
                    const actualCount = preconditionsCounts.get(preLabel) || 0;

                    if (actualCount !== expectedWeight) {
                        /* eslint-disable-next-line max-len */
                        const errorMessage = `Check the preconditions of event "${nodeLabel}". It requires ${expectedWeight} ${expectedWeight > 1 ? 'preconditions' : 'precondition'} from "${preLabel}", but has ${actualCount}`;
                        nodeValidityMap.set(event.id, {
                            status: 'invalid',
                            reasons: [errorMessage]
                        });

                        // Markiere die fehlende/unvollständige Vorbedingung im Prozessnetz (falls vorhanden)
                        const relevantPreconditions = preconditions.filter(p => p.effectiveLabel() === preLabel);
                        for (const pre of relevantPreconditions) {
                            const processNetEdge = processNet.findEdgeById(pre.id, nodeId);
                            if (processNetEdge) {
                                edgeValidityMap.set(processNetEdge, {
                                    status: 'partly-valid',
                                    reasons: [errorMessage]
                                });
                            }
                            nodeValidityMap.set(pre.id, {
                                status: 'partly-valid',
                                reasons: [errorMessage]
                            });
                        }

                        setError({
                            status: 'invalid',
                            message: 'Check the preconditions of your events',
                            hint: errorMessage
                        });
                    }
                }

                const postconditions = processNet.getRelated(event, 'out');
                const postconditionsCounts = new Map<string, number>();
                const petriNetPostconditions = petriNet.getRelated(transition, 'out');

                // Für jedes Ereignis müssen die Nachbedingungen der Transition im Petrinetz entsprechen
                for (const condition of postconditions) {
                    const postId = condition.id;
                    const postLabel = condition.effectiveLabel();
                    // Prüfe, ob Kante im Petrinetz existiert
                    if (!petriNet.hasEdgeByEffectiveLabel(nodeLabel, postLabel)) {
                        const errorMessage = `Check the postconditions of event "${nodeLabel}". The Petri net has no edge from "${nodeLabel}" to "${postLabel}"`;
                        nodeValidityMap.set(event.id, {
                            status: 'invalid',
                            reasons: [errorMessage]
                        });
                        nodeValidityMap.set(condition.id, {
                            status: 'invalid',
                            reasons: [errorMessage]
                        });
                        edgeValidityMap.set(processNet.findEdgeById(nodeId, postId)!, {
                            status: 'invalid',
                            reasons: [errorMessage]
                        });
                        setError({
                            status: 'invalid',
                            message: 'Check the postcondition edges of your events',
                            hint: errorMessage
                        });
                    }

                    postconditionsCounts.set(postLabel, (postconditionsCounts.get(postLabel) || 0) + 1);
                }

                // Prüfe, dass Anzahl der Nachbedingungen dem Kantengewicht entspricht
                for (const [postLabel, count] of postconditionsCounts) {
                    const edge = petriNet.findEdgeByEffectiveLabel(nodeLabel, postLabel);
                    const expectedWeight = edge?.weight() || 1;
                    if (count !== expectedWeight) {
                        /* eslint-disable-next-line max-len */
                        const errorMessage = `Check the postconditions of event "${nodeLabel}". It requires ${expectedWeight} ${expectedWeight > 1 ? 'postconditions' : 'postcondition'} to "${postLabel}", but has "${count}"`;
                        nodeValidityMap.set(event.id, {
                            status: 'invalid',
                            reasons: [errorMessage]
                        });
                        const relevantPostconditions = postconditions.filter(p => p.effectiveLabel() === postLabel);
                        for (const post of relevantPostconditions) {
                            const processNetEdge = processNet.findEdgeById(nodeId, post.id);
                            if (processNetEdge) {
                                edgeValidityMap.set(processNetEdge, {
                                    status: 'partly-valid',
                                    reasons: [errorMessage]
                                });
                            }
                            nodeValidityMap.set(post.id, {
                                status: 'partly-valid',
                                reasons: [errorMessage]
                            });
                        }
                        setError({
                            status: 'invalid',
                            message: 'Check the postconditions of your events',
                            hint: errorMessage
                        });
                    }
                }

                // Prüfe alle erwarteten Nachbedingungen aus dem Petrinetz
                // (auch wenn das Prozessnetz bereits einige Nachbedingungen hat, könnten andere fehlen)
                for (const condition of petriNetPostconditions) {
                    const postLabel = condition.effectiveLabel();
                    const edge = petriNet.findEdgeByEffectiveLabel(nodeLabel, postLabel);
                    const expectedWeight = edge?.weight() || 1;
                    const actualCount = postconditionsCounts.get(postLabel) || 0;

                    if (actualCount !== expectedWeight) {
                        /* eslint-disable-next-line max-len */
                        const errorMessage = `Check the postconditions of event "${nodeLabel}". It requires ${expectedWeight} ${expectedWeight > 1 ? 'postconditions' : 'postcondition'} to "${postLabel}", but has ${actualCount}`;
                        nodeValidityMap.set(event.id, {
                            status: 'partly-valid',
                            reasons: [errorMessage]
                        });

                        // Markiere die fehlende/unvollständige Nachbedingung im Prozessnetz (falls vorhanden)
                        const relevantPostconditions = postconditions.filter(p => p.effectiveLabel() === postLabel);
                        for (const post of relevantPostconditions) {
                            const processNetEdge = processNet.findEdgeById(nodeId, post.id);
                            if (processNetEdge) {
                                edgeValidityMap.set(processNetEdge, {
                                    status: 'partly-valid',
                                    reasons: [errorMessage]
                                });
                            }

                            nodeValidityMap.set(post.id, {
                                status: 'partly-valid',
                                reasons: [errorMessage]
                            });
                        }

                        setError({
                            status: 'invalid',
                            message: 'Check the postconditions of your events',
                            hint: errorMessage
                        });
                    }
                }
            }
        }

        // Validierung 4: Prüfe Erreichbarkeit der verpflichtenden Transitionen
        // Bei angegebenen mandatoryTransitions gilt das Prozessnetz als gültig, sobald die Sequenz abgearbeitet wurde.
        if (hasMandatoryTransitions) {
            // Überprüfe, ob die verpflichtenden Transitionen überhaupt von der Schaltsequenz erreicht werden können
            const reachableSequence = findReachableSequence(petriNet, mandatoryTransitions);
            console.log(reachableSequence);
            for (const transitionLabel of reachableSequence) {
                const transition = processNet.findNodeByEffectiveLabel(transitionLabel, 'transition');
                if (!transition) {
                    setError({
                        status: 'invalid',
                        message: 'Check your mandatory transitions',
                        hint: `Transition "${transitionLabel}" needed for the mandatory transition to be reachable`
                    });

                    const petriNetTransition = petriNet.findNodeByEffectiveLabel(transitionLabel, 'transition');
                    if (petriNetTransition) {
                        // Finde notwendige Preconditions im Prozessnetz für diese Transition
                        const preconditions = petriNet.getRelated(petriNetTransition, 'in');
                        for (const condition of preconditions) {
                            const processNetConditions = processNet.findNodesByEffectiveLabel(condition.effectiveLabel(), 'place');
                            for (const processNetCondition of processNetConditions) {
                                if (nodeValidityMap.has(processNetCondition.id) && nodeValidityMap.get(processNetCondition.id)!.status !== 'valid') {
                                    continue;
                                }
                                nodeValidityMap.set(processNetCondition.id, {
                                    status: 'partly-valid',
                                    reasons: [`Transition "${transitionLabel}" needed for the mandatory transition to be reachable`]
                                });
                            }
                        }

                        // Finde notwendige Postconditions im Prozessnetz für diese Transition, die noch isoliert sind, also keine eingehende Kante haben
                        const postconditions = petriNet.getRelated(petriNetTransition!, 'out');
                        for (const condition of postconditions) {
                            const processNetConditions = processNet.findNodesByEffectiveLabel(condition.effectiveLabel(), 'place');
                            for (const processNetCondition of processNetConditions) {
                                if (processNet.incomingEdges(processNetCondition).length === 0) {
                                    if (nodeValidityMap.has(processNetCondition.id) && nodeValidityMap.get(processNetCondition.id)!.status !== 'valid') {
                                        continue;
                                    }
                                    nodeValidityMap.set(processNetCondition.id, {
                                        status: 'partly-valid',
                                        reasons: [`Transition "${transitionLabel}" needed for the mandatory transition to be reachable`]
                                    });
                                }
                            }
                        }
                    }
                }
            }
            for (const mandatoryTransition of mandatoryTransitions) {
                const transition = processNet.findNodeByEffectiveLabel(mandatoryTransition, 'transition');
                if (!transition) {
                    setError({
                        status: 'invalid',
                        message: 'Check your mandatory transitions',
                        hint: `Mandatory transition "${mandatoryTransition}" does not fire`
                    });

                    // Markiere alle Knoten und Kanten als invalid
                    for (const node of processNet.nodes) {
                        if (nodeValidityMap.has(node.id) && nodeValidityMap.get(node.id)!.status !== 'valid') {
                            continue;
                        }
                        nodeValidityMap.set(node.id, {
                            status: 'partly-valid',
                            reasons: [`Mandatory transition "${mandatoryTransition} not fulfilled`]
                        });
                    }
                    for (const edge of processNet.edges) {
                        if (edgeValidityMap.has(edge) && edgeValidityMap.get(edge)!.status !== 'valid') {
                            continue;
                        }
                        edgeValidityMap.set(edge, {
                            status: 'partly-valid',
                            reasons: [`Mandatory transition "${mandatoryTransition}" not fulfilled`]
                        });
                    }
                    break;
                }
            }
        }

        // Validierung 5: Prüfe Vollständigkeit (nur wenn keine strukturellen Fehler vorliegen UND keine mandatoryTransitions angegeben wurden)
        // Die Vollständigkeitsprüfung macht nur Sinn, wenn das Prozessnetz strukturell korrekt ist,
        // da sie auf der korrekten Struktur (Labels, Kanten, Gewichte) basiert.
        if (!hasStructuralError && !hasMandatoryTransitions) {
            // Das Prozessnetz ist vollständig, wenn keine Transition mehr schaltbar ist
            // Berechne aktuelle Markierung M aus den "freien" Bedingungen (ohne ausgehende Kante)
            // Ermittle die aktuelle Markierung der "freien" Bedingungen
            // Freie Bedingungen = Bedingungen ohne ausgehende Kante zu einem Ereignis
            const freeConditions = processNet.nodes.filter(n => n.kind === 'place' && !processNet.edges.some(e => e.source.id === n.id && e.target.kind === 'transition'));

            // Erstelle Markierung
            const currentMarking = new Map<string, number>();
            for (const condition of freeConditions) {
                const nodeLabel = condition.effectiveLabel();
                currentMarking.set(nodeLabel, (currentMarking.get(nodeLabel) || 0) + 1);
            }

            // Prüfe für jede Transition im Petrinetz, ob sie schaltbar ist
            const transitions = petriNet.nodes.filter(n => n.kind === 'transition');
            for (const transition of transitions) {
                if (isTransitionEnabled(transition, currentMarking, petriNet)) {
                    const nodeLabel = transition.effectiveLabel();

                    const transitionPreconditions = petriNet.getRelated(transition, 'in');
                    for (const condition of transitionPreconditions) {
                        const processNetConditions = processNet.findNodesByEffectiveLabel(condition.effectiveLabel(), 'place');
                        for (const processNetCondition of processNetConditions) {
                            if (processNet.outgoingEdges(processNetCondition).length === 0) {
                                nodeValidityMap.set(processNetCondition.id, {
                                    status: 'partly-valid',
                                    reasons: [`Transition "${nodeLabel}" can still be fired`]
                                });
                            }
                        }
                    }

                    setError({
                        status: 'valid-incomplete',
                        message: 'Process net is valid but not complete',
                        hint: `Transition "${nodeLabel}" can still be fired`
                    });
                }
            }
        }

        applyValidityToProcessNet(processNet, nodeValidityMap, edgeValidityMap);

        if (!firstError) {
            return {
                status: 'valid-complete',
                message: 'Process net is valid and complete'
            };
        }

        return firstError;
    }

    validateMandatoryTransitions(petriNet: Diagram, mandatoryTransitions: string[]): ProcessNetValidationResult {
        if (mandatoryTransitions.length === 0) {
            return {
                status: 'valid',
                message: 'No mandatory transitions given'
            };
        }

        const allTransitions = petriNet.nodes.filter(n => n.kind === 'transition');
        const transitionLabels = allTransitions.map(t => t.effectiveLabel());

        // Existieren alle verpflichtenden Transitionen im Petrinetz?
        const missingTransitions: string[] = [];
        for (const label of mandatoryTransitions) {
            if (!transitionLabels.includes(label)) {
                missingTransitions.push(label);
            }
        }

        if (missingTransitions.length > 0) {
            return {
                status: 'invalid',
                message: 'Check your mandatory transitions',
                /* eslint-disable-next-line max-len */
                hint: `Mandatory transition${missingTransitions.length === 1 ? '' : 's'} "${missingTransitions.join(', ')}" do${missingTransitions.length === 1 ? 'es' : ''} not exist`
            };
        }

        // Können die Transitionen überhaupt schalten?
        const reachableSequence = findReachableSequence(petriNet, mandatoryTransitions);
        if (reachableSequence.length === 0) {
            return {
                status: 'invalid',
                message: 'Check your mandatory transitions',
                /* eslint-disable-next-line max-len */
                hint: `Given mandatory transition${mandatoryTransitions.length === 1 ? '' : 's'} ${mandatoryTransitions.length === 1 ? 'is' : 'are'} not reachable from the initial marking`
            };
        }

        return {
            status: 'valid',
            message: 'All mandatory transitions are valid'
        };
    }

}
