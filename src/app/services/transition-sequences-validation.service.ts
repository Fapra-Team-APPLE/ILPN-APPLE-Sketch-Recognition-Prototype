import {Injectable, signal} from '@angular/core';
import {Diagram} from '../classes/diagram/diagram';
import {DiagramNode} from '../classes/diagram/diagram-node';


@Injectable({
    providedIn: 'root'
})
export class TransitionSequencesValidationService {

    firedTransitions = signal<string[]>([]);
    firedTransitionsProcessNet = signal<string[]>([]);
    firedTransitionsReachability = signal<string[]>([]);
    lastUpdateSource = signal<'tokenGame' | 'processNet'>('tokenGame');
    sequences = signal<string[]>([]);

    isActivated(diagram: Diagram<DiagramNode>, transition: DiagramNode): boolean {
        const incoming = diagram.incomingEdges(transition);
        // kein Vorbereich -> Transition immer aktiviert
        if (incoming.length === 0) {
            transition.setActivated(true);
            return true;
        }

        for (const edge of incoming) {
            if (edge.weight() > edge.source.tokenCount) {
                transition.setActivated(false);
                return false;
            }
        }

        transition.setActivated(true);
        return true;
    }


    fireTransition(diagram: Diagram<DiagramNode>, transition: DiagramNode, record: boolean = true, context: 'sequences' | 'process-net' | 'reachability' = 'sequences'): void {
        if (this.isActivated(diagram, transition)) {
            for (const edge of diagram.incomingEdges(transition)) {
                edge.source.tokenCount = edge.source.tokenCount - edge.weight();
            }
            for (const edge of diagram.outgoingEdges(transition)) {
                edge.target.tokenCount = edge.target.tokenCount + edge.weight();
            }
            if (!record) {
                return;
            }
            if (context === 'sequences') {
                this.firedTransitions.update(transitions => [...transitions, transition.effectiveLabel()]);
            } else if (context === 'process-net') {
                this.lastUpdateSource.set('tokenGame');
                this.firedTransitionsProcessNet.update(transitions => [...transitions, transition.effectiveLabel()]);
            } else if (context === 'reachability') {
                this.firedTransitionsReachability.update(transitions => [...transitions, transition.effectiveLabel()]);
            }
        }
    }

    validateTransitionSequenceDetailed(diagram: Diagram<DiagramNode>, transitionSequence: string): {transition: string, valid: boolean}[] {
        const result: {transition: string, valid: boolean}[] = [];
        for (const transitionName of transitionSequence.split(' ')) {
            if (!transitionName) {
                continue;
            }
            const transition = diagram.findNodeByEffectiveLabel(transitionName, 'transition');
            if (!transition) {
                result.push({transition: transitionName, valid: false});
                break;
            } else {
                if (this.isActivated(diagram, transition)) {
                    this.fireTransition(diagram, transition, false);
                    result.push({transition: transitionName, valid: true});
                } else {
                    result.push({transition: transitionName, valid: false});
                    break;
                }
            }
        }

        // Wenn die Sequenz nicht vollständig verarbeitet wurde, die restlichen Transitionen als ungültig markieren
        const processedCount = result.length;
        const allTransitions = transitionSequence.split(' ').filter(t => t);
        if (processedCount < allTransitions.length) {
            for (let i = processedCount; i < allTransitions.length; i++) {
                result.push({transition: allTransitions[i], valid: false});
            }
        }

        return result;
    }

    markActivatedTransition(petriNet: Diagram<DiagramNode>): void {
        const transitionNodes = petriNet.nodes.filter(n => n.kind === 'transition');
        for (const nodeID in transitionNodes) {
            const transition = transitionNodes[nodeID];
            if (this.isActivated(petriNet, transition)) {
                transition.setActivated(true);
            } else {
                transition.setActivated(false);
            }
        }
    }

    getCanonicalSequence(diagram: Diagram<DiagramNode>, sequence: string): string {
        return sequence.split(' ')
            .filter(t => t)
            .map(name => {
                const node = diagram.findNodeByEffectiveLabel(name, 'transition');
                return node ? node.effectiveLabel() : name;
            })
            .join(' ');
    }

    resetFiredTransitions() {
        this.firedTransitions.set([]);
    }

    resetFiredTransitionsProcessNet() {
        this.lastUpdateSource.set('processNet');
        this.firedTransitionsProcessNet.set([]);
    }

    resetFiredTransitionsReachability() {
        this.firedTransitionsReachability.set([]);
    }

    addSequence(sequence: string) {
        this.sequences.update(seqs => [sequence, ...seqs]);
    }

    removeSequence(index: number) {
        this.sequences.update(seqs => seqs.filter((_, i) => i !== index));
    }

    clearSequences() {
        this.sequences.set([]);
    }

    findMaximalTransitionSequences(
        inputDiagram: Diagram<DiagramNode>,
        options?: {maxDepth?: number; maxResults?: number; includeLoopTerminal?: boolean}
    ): string[] {
        const diagram = inputDiagram.clone();
        const maxDepth = options?.maxDepth ?? 30;
        const includeLoopTerminal = options?.includeLoopTerminal ?? true;

        const maxResults = options?.maxResults ?? 300;
        let aborted = false;

        // Transition List -> Transitionen im Diagramm (stabil sortiert für reproduzierbare Ausgabe)
        const transitions = diagram.nodes
            .filter(n => n.kind === 'transition')
            .slice()
            .sort((a, b) => (a.effectiveLabel() ?? '').localeCompare(b.effectiveLabel() ?? ''));

        // Token-Snapshot/Restore (minimalinvasiv: wir kopieren nur tokenCount pro Node-Referenz)
        const snapshotTokens = (): Map<DiagramNode, number> => {
            const snap = new Map<DiagramNode, number>();
            for (const n of diagram.nodes) {
                snap.set(n, n.tokenCount);
            }
            return snap;
        };
        // setzt tokenCount auf alte Werte zurück -> alle Simulationen der Schaltungen sind damit reversibel
        const restoreTokens = (snap: Map<DiagramNode, number>) => {
            for (const [n, cnt] of snap.entries()) {
                n.tokenCount = cnt;
            }
        };

        // Marking-Key für Loop-Erkennung z.B.p1:1|p2:0|p3:2 -> Finger print für aktuelle Markierung der Places
        const markingKey = (): string => {
            const places = diagram.nodes
                .filter(n => n.kind === 'place')
                .slice()
                .sort((a, b) => (a.effectiveLabel() ?? '').localeCompare(b.effectiveLabel() ?? ''));
            return places.map(p => `${p.effectiveLabel()}:${p.tokenCount}`).join('|');
        };

        // sammle die geschalteten transitionen als strings in results
        const results: string[] = [];

        const dfs = (currentSeq: string[], seenMarkingsInPath: Set<string>, depth: number) => {
            // harter Cutoff -> abort = true, wenn maximale Anzahl an Sequenzen errreicht
            if (aborted || results.length >= maxResults) {
                aborted = true;
                return;
            }
            const key = markingKey();

            if (seenMarkingsInPath.has(key)) {
                if (includeLoopTerminal) {
                    results.push(currentSeq.join(' ').trim());
                }
                return;
            }
            if (depth >= maxDepth) {
                results.push(currentSeq.join(' ').trim());
                return;
            }

            const nextSeen = new Set(seenMarkingsInPath);
            nextSeen.add(key);

            const enabled = transitions.filter(t => this.isActivated(diagram, t));

            if (enabled.length === 0) {
                results.push(currentSeq.join(' ').trim());
                return;
            }

            for (const t of enabled) {
                if (aborted) {
                    return;
                }

                const snap = snapshotTokens();
                this.fireTransition(diagram, t, false, 'sequences');

                currentSeq.push(t.effectiveLabel());
                dfs(currentSeq, nextSeen, depth + 1);
                currentSeq.pop();

                restoreTokens(snap);
            }
        };

        dfs([], new Set<string>(), 0);

        return results;
    }

}
