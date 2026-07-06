import {computed, effect, Injectable, signal, untracked} from '@angular/core';
import {toObservable} from '@angular/core/rxjs-interop';
import {BehaviorSubject, Observable} from 'rxjs';
import {Diagram} from '../classes/diagram/diagram';
import {PetriNet, ProcessNet} from '../classes/diagram/diagram-types';
import {ReachabilityGraph} from '../classes/reachability/reachability-graph';
import {Marking} from '../classes/reachability/reachability-node';

@Injectable({
    providedIn: 'root'
})
export class DisplayService {

    public petriNetSet = computed(() => {
        const diagram = this.diagram();
        return !!diagram && diagram.nodes.length > 0;
    });

    public examMode = signal<boolean>(false);
    public showHints = computed(() => !this.examMode());

    public diagram = signal<PetriNet>(new Diagram([]));
    public petriNetNonCoordinateChange = computed(() => {
        const diagram = this.diagram();
        const hash = this.computePetriNetHashWithoutCoordinates(diagram);
        return {diagram, hash};
    });

    firingSequencesTokenGameEnabled = signal<boolean>(true);
    reachabilityTokenGameEnabled = signal<boolean>(true);
    processNetTokenGameEnabled = signal<boolean>(true);

    public firingSequencesPetriNetPreview = signal<PetriNet>(new Diagram([]));
    public reachabilityPetriNetPreview = signal<PetriNet>(new Diagram([]));
    public processNetPetriNetPreview = signal<PetriNet>(new Diagram([]));
    private _reachabilityGraph$: BehaviorSubject<ReachabilityGraph>;
    private _processNet$ = new BehaviorSubject<ProcessNet>(new Diagram([]));

    private readonly undoStack = signal<PetriNet[]>([]);
    private readonly redoStack = signal<PetriNet[]>([]);
    public readonly canUndo = computed(() => this.undoStack().length > 0);
    public readonly canRedo = computed(() => this.redoStack().length > 0);

    constructor() {
        this._reachabilityGraph$ = new BehaviorSubject<ReachabilityGraph>(new ReachabilityGraph());

        effect(() => {
            const diagram = this.diagram();
            const nodeUpdates = diagram.nodes.map(n => ({id: n.id, x: n.x(), y: n.y()}));
            const edgeUpdates = diagram.edges.map(e => ({sourceId: e.source.id, targetId: e.target.id, waypoints: e.waypoints()}));

            untracked(() => {
                this.syncCoordinates(this.firingSequencesPetriNetPreview(), nodeUpdates);
                this.syncWaypoints(this.firingSequencesPetriNetPreview(), edgeUpdates);
                this.syncCoordinates(this.reachabilityPetriNetPreview(), nodeUpdates);
                this.syncWaypoints(this.reachabilityPetriNetPreview(), edgeUpdates);
                this.syncCoordinates(this.processNetPetriNetPreview(), nodeUpdates);
                this.syncWaypoints(this.processNetPetriNetPreview(), edgeUpdates);
            });
        });
    }

    public get diagram$(): Observable<PetriNet> {
        return toObservable(this.diagram);
    }

    public display(net: PetriNet | null) {
        const diagram = net ?? new Diagram([]);
        this.diagram.set(diagram);
        this.firingSequencesPetriNetPreview.set(diagram.clone());
        this.reachabilityPetriNetPreview.set(diagram.clone());
        this.processNetPetriNetPreview.set(diagram.clone());
    }

    public saveHistoryStep(): void {
        const current = this.diagram();
        if (current) {
            this.undoStack.update(stack => {
                const next = [...stack, current.clone()];
                if (next.length > 50) {
                    next.shift();
                }
                return next;
            });
            this.redoStack.set([]);
        }
    }

    public clearHistory(): void {
        this.undoStack.set([]);
        this.redoStack.set([]);
    }

    public undo(): void {
        const undo = this.undoStack();
        if (undo.length === 0) {
            return;
        }
        const current = this.diagram();
        if (current) {
            this.redoStack.update(redo => [...redo, current.clone()]);
        }
        const nextUndo = [...undo];
        const previous = nextUndo.pop();
        this.undoStack.set(nextUndo);
        if (previous) {
            this.display(previous);
        }
    }

    public redo(): void {
        const redo = this.redoStack();
        if (redo.length === 0) {
            return;
        }
        const current = this.diagram();
        if (current) {
            this.undoStack.update(undo => {
                const next = [...undo, current.clone()];
                if (next.length > 50) {
                    next.shift();
                }
                return next;
            });
        }
        const nextRedo = [...redo];
        const next = nextRedo.pop();
        this.redoStack.set(nextRedo);
        if (next) {
            this.display(next);
        }
    }


    public get reachabilityGraph$(): Observable<ReachabilityGraph> {
        return this._reachabilityGraph$.asObservable();
    }

    public get reachabilityGraph(): ReachabilityGraph {
        return this._reachabilityGraph$.getValue();
    }

    public updateReachabilityPreviewMarking(marking: Marking) {
        const updatedPreview = this.reachabilityPetriNetPreview().clone();

        updatedPreview.nodes.forEach(node => {
            if (node.kind === 'place') {
                const count = marking[node.id];
                if (count !== undefined) {
                    node.tokenCount = count === 'w' ? 999 : count;
                }
            }
        });

        this.reachabilityPetriNetPreview.set(updatedPreview);
    }

    public displayReachabilityGraph(graph: ReachabilityGraph | null) {
        this._reachabilityGraph$.next(graph ?? new ReachabilityGraph());
    }

    public get processNet$(): Observable<ProcessNet> {
        return this._processNet$.asObservable();
    }

    public get processNet(): ProcessNet {
        return this._processNet$.getValue();
    }

    public displayProcessNet(net: ProcessNet | null) {
        this._processNet$.next(net ?? new Diagram([]));
    }

    private syncCoordinates(target: PetriNet, updates: {id: string; x: number; y: number}[]) {
        if (!target || target.nodes.length === 0) {
            return;
        }
        const targetNodes = new Map(target.nodes.map(n => [n.id, n]));
        for (const update of updates) {
            const node = targetNodes.get(update.id);
            if (node) {
                node.setX(update.x);
                node.setY(update.y);
            }
        }
    }

    private syncWaypoints(target: PetriNet, updates: {sourceId: string; targetId: string; waypoints: Array<{x: number; y: number}>}[]) {
        if (!target || target.edges.length === 0) {
            return;
        }
        const targetEdges = target.edges.map(e => ({
            edge: e,
            key: `${e.source.id}|${e.target.id}`
        }));
        const edgeMap = new Map(targetEdges.map(e => [e.key, e.edge]));
        for (const update of updates) {
            const key = `${update.sourceId}|${update.targetId}`;
            const edge = edgeMap.get(key);
            if (edge) {
                edge.waypoints.set(update.waypoints);
            }
        }
    }

    private computePetriNetHashWithoutCoordinates(diagram: PetriNet | null): string {
        if (!diagram) {
            return '';
        }
        const nodes = diagram.nodes.map(n => {
            const tokenCount = n.kind === 'place' ? n.tokenCount : '';
            return `${n.id}|${n.kind}|${n.label()}|${tokenCount}`;
        }).sort().join(';');

        const edges = diagram.edges.map(edge => {
            return `${edge.source.id}|${edge.target.id}|${edge.weight()}|${edge.label()}`;
        }).sort().join(';');

        return `${nodes}##${edges}`;
    }

}
