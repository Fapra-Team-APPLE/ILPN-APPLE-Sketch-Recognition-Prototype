import {OverlayModule} from '@angular/cdk/overlay';
import {PortalModule} from '@angular/cdk/portal';
import {Component, computed, DestroyRef, effect, inject, OnDestroy, signal, Signal, untracked} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {calculateCurveIndex, getEdgeKey, groupEdgesByDirection} from '../../classes/diagram/diagram-layout-helper';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {DiagramHint, DiagramValidity, IDiagramNode} from '../../classes/diagram/diagram-types';
import {Coords} from '../../classes/json-petri-net';
import {ReachabilityEdge} from '../../classes/reachability/reachability-edge';
import {ReachabilityGraph} from '../../classes/reachability/reachability-graph';
import {ReachabilityNode} from '../../classes/reachability/reachability-node';
import {SvgDefsIdContextDirective} from '../../directives/svg-defs-id-context.directive';
import {DisplayService} from '../../services/display.service';
import {NodeDimensionService} from '../../services/node-dimension.service';
import {OverlayEditService} from '../../services/overlay-edit.service';
import {OverlayService} from '../../services/overlay.service';
import {ReachabilityGraphGeneratorService} from '../../services/reachability/reachability-graph-generator.service';
import {ReachabilityLayoutService} from '../../services/reachability/reachability-layout.service';
import {ReachabilityValidationService} from '../../services/reachability/reachability-validation.service';
import {ReachabilityService} from '../../services/reachability/reachability.service';
import {SnackbarService} from '../../services/snackbar.service';
import {TransitionSequencesValidationService} from '../../services/transition-sequences-validation.service';
import {ValidationResult, ValidationService} from '../../services/validation.service';
import {DisplayComponent} from '../display/display.component';
import {SvgEdgeComponent} from '../display/svg-edge/svg-edge.component';
import {calculateNodeMargins} from '../display/svg-node/svg-node';
import {SvgNodeComponent} from '../display/svg-node/svg-node.component';
import {ArcDrawingController} from '../shared/arc-drawing.controller';
import {CanvasPanningController} from '../shared/canvas-panning.controller';
import {CanvasResizeController} from '../shared/canvas-resize.controller';
import {EraserController} from '../shared/eraser.controller';
import {LightbulbController} from '../shared/lightbulb.controller';
import {OverlayLabelInputComponent} from '../shared/overlay-label-input/overlay-label-input.component';
import {ToolType} from '../toolbar/tool.types';
import {ToolboxTextButtonComponent} from '../toolbar/toolbox-text-button/toolbox-text-button.component';
import {ToolboxComponent} from '../toolbar/toolbox.component';

class MergedReachabilityEdge extends ReachabilityEdge {

    __originalEdges: ReachabilityEdge[];
    override readonly validity: Signal<DiagramValidity>;

    // eslint-disable-next-line max-params
    constructor(
        source: ReachabilityNode,
        target: ReachabilityNode,
        label: string,
        waypoints: Coords[],
        curveIndex: number,
        originalEdges: ReachabilityEdge[]
    ) {
        super(source, target, label, waypoints, curveIndex);
        this.__originalEdges = originalEdges;
        this.validity = computed(() => {
            if (this.__originalEdges.length === 1) {
                return this.__originalEdges[0].validity();
            }

            let mergedStatus: DiagramValidity = {status: 'valid'};
            const mergedReasons: string[] = [];

            for (const edge of this.__originalEdges) {
                const edgeValidity = edge.validity();
                if (!edgeValidity) {
                    continue;
                }
                if (edgeValidity.status === 'invalid') {
                    mergedStatus = {status: 'invalid', reasons: []};
                    mergedReasons.push(...(edgeValidity.reasons ?? []));
                } else if (edgeValidity.status === 'partly-valid' && mergedStatus.status !== 'invalid') {
                    mergedStatus = {status: 'partly-valid', reasons: []};
                    mergedReasons.push(...(edgeValidity.reasons ?? []));
                }
            }

            if (mergedStatus.status !== 'valid') {
                return {status: mergedStatus.status, reasons: [...new Set(mergedReasons)]};
            }
            return this.__originalEdges[0]?.validity();
        });
    }

}

interface VisualReachabilityEdge extends ReachabilityEdge {
    __originalEdges?: ReachabilityEdge[];
}

@Component({
    selector: 'app-reachability',
    standalone: true,
    imports: [
        SvgNodeComponent,
        SvgEdgeComponent,
        SvgDefsIdContextDirective,
        DisplayComponent,
        ToolboxComponent,
        ToolboxTextButtonComponent,
        OverlayModule,
        PortalModule,
        OverlayLabelInputComponent
    ],
    templateUrl: './reachability.component.html',
    providers: [NodeDimensionService, OverlayEditService],
    styleUrls: ['./reachability.component.scss'],
    host: {
        '[class.eraser-active]': 'this.selectedTool() === "eraser"',
        '[class.lightbulb-active]': 'this.selectedTool() === "lightbulb"'
    }
})
export class ReachabilityComponent implements OnDestroy {

    protected displayService = inject(DisplayService);
    private nodeDimensionService = inject(NodeDimensionService);
    private destroyRef = inject(DestroyRef);
    private snackbarService = inject(SnackbarService);
    private reachabilityService = inject(ReachabilityService);
    private reachabilityValidationService = inject(ReachabilityValidationService);
    private reachabilityGenerator = inject(ReachabilityGraphGeneratorService);
    private reachabilityLayoutService = inject(ReachabilityLayoutService);
    private validationService = inject(ValidationService);
    private overlayService = inject(OverlayService);
    private transitionValidationService = inject(TransitionSequencesValidationService);

    readonly showHints = this.displayService.showHints;

    readonly infinityHint = signal<DiagramHint | undefined>(undefined);

    private lastSuccessGraphHash: string | null = null;

    readonly graph = signal<ReachabilityGraph | undefined>(undefined);
    readonly activeNode = computed(() => {
        const graph = this.graph();
        if (!graph) {
            return undefined;
        }
        return graph.nodes.find(n => n.activated());
    });

    readonly visualEdges = computed(() => {
        // Kanten-Gruppierung nach Quelle und Ziel (Multi-Edges zusammenfassen)
        const graph = this.graph();
        if (!graph) {
            return [];
        }

        const groups = groupEdgesByDirection(graph.edges) as Map<string, ReachabilityEdge[]>;

        const resultVisualEdges: ReachabilityEdge[] = [];
        for (const group of groups.values()) {
            const first = group[0];
            const label = group.map(e => e.label()).join(', ');

            const reverseKey = getEdgeKey(first.target.id, first.source.id);
            const hasReverseEdges = groups.has(reverseKey);
            const curveIndex = calculateCurveIndex(first.source.id, first.target.id, hasReverseEdges);

            const merged = new MergedReachabilityEdge(first.source, first.target, label, first.waypoints(), curveIndex, group);

            merged.setLabel = (val: string | undefined) => {
                this.updateMultiEdgeLabel(group, val, first.source, first.target, first.waypoints());
            };

            resultVisualEdges.push(merged);
        }
        return resultVisualEdges;
    });

    readonly placeIds = computed(() => {
        const diagram = this.displayService.diagram();
        if (!diagram) {
            return [];
        }
        return this.reachabilityService.getPlaceIds(diagram);
    });

    // Startkante als DiagramEdge von einem virtuellen Startknoten zum initialen Knoten
    readonly startArrowEdge = computed<DiagramEdge | undefined>(() => {
        const init = this.reachabilityService.findInitialNode(this.graph());
        if (!init) {
            return undefined;
        }

        const initDim = this.nodeDimensionService.getDimension(init.id)();

        // WorkAround bei der Umstellung des Labels auf Signal -> Verbesserung mit eigener virtualSource Klasse
        const dummyLabelSignal = signal<string>('');

        const virtualSource: IDiagramNode = {
            id: '__start__',
            kind: 'state',
            label: dummyLabelSignal,
            effectiveLabel: dummyLabelSignal,
            x: computed(() => init.x() - (initDim.w / 2) - 80),
            y: computed(() => init.y()),
            validity: signal<undefined>(undefined),
            activated: signal<boolean>(false),
            setX: (_val: number) => { /* noop */},
            setY: (_val: number) => { /* noop */},
            setValidity: (_status: undefined) => { /* noop */},
            clone(): IDiagramNode { /* noop */ return new DiagramNode('__start__', 'state'); }
        };
        return new DiagramEdge(virtualSource, init, 1, [], undefined);
    });

    readonly edgeToEdit = signal<string | null>(null);

    readonly selectedTool = signal<ToolType | undefined>(undefined);

    readonly resizeController = new CanvasResizeController();


    private readonly panningController = new CanvasPanningController({
        canStartPanning: () => !this.selectedTool(),
        ignoreBoundaries: false,
        diagram: () => this.graph(),
        nodeDimensionService: this.nodeDimensionService
    });

    readonly canvasCursor = computed(() => {
        if (this.selectedTool()) {
            return undefined;
        }
        return 'move'; // panning cursor
    });

    private eraserController = new EraserController<ReachabilityNode, ReachabilityEdge>({
        getSelectedTool: () => this.selectedTool(),
        getNodes: () => {
            const g = this.graph();
            if (!g) {
                return [];
            }
            const init = this.reachabilityService.findInitialNode(g);
            // Initiale Node darf nicht gelöscht werden
            return g.nodes.filter(n => n.id !== init?.id);
        },
        getEdges: () => this.visualEdges(),
        setDiagram: (nodes, edges) => {
            const g = this.graph();
            if (!g) {
                const reconstructedEdges: ReachabilityEdge[] = [];
                for (const edge of edges) {
                    const visualReachabilityEdge = edge as VisualReachabilityEdge;
                    if (visualReachabilityEdge.__originalEdges) {
                        reconstructedEdges.push(...visualReachabilityEdge.__originalEdges);
                    } else {
                        reconstructedEdges.push(edge);
                    }
                }
                this.graph.set(new ReachabilityGraph([...nodes], reconstructedEdges));
                return;
            }
            const init = this.reachabilityService.findInitialNode(g);
            let mergedNodes = [...nodes];
            if (init && !mergedNodes.some(n => n.id === init.id)) {
                // Initialen Knoten wieder hinzufügen, weil er dem Eraser-Controller nicht bekannt gemacht wurde
                mergedNodes = [init, ...mergedNodes];
            }

            const reconstructedEdges: ReachabilityEdge[] = [];
            for (const edge of edges) {
                const visualReachabilityEdge = edge as VisualReachabilityEdge;
                if (visualReachabilityEdge.__originalEdges) {
                    reconstructedEdges.push(...visualReachabilityEdge.__originalEdges);
                } else {
                    reconstructedEdges.push(edge);
                }
            }

            if (!mergedNodes.some(n => n.activated()) && init) {
                init.setActivated(true);
            }

            this.graph.set(new ReachabilityGraph(mergedNodes, reconstructedEdges));
        },
        findSvgForEventTarget: (target) => (target as Element | null)?.closest('svg') as SVGSVGElement | null,
        getNodeDimension: (id: string) => this.nodeDimensionService.getDimension(id)()
    });

    private lightbulbController = new LightbulbController<ReachabilityNode, ReachabilityEdge>({
        getSelectedTool: () => this.selectedTool(),
        getNodes: () => this.graph()?.nodes ?? [],
        getEdges: () => this.visualEdges(),
        findSvgForEventTarget: (target) => (target as Element | null)?.closest('svg') as SVGSVGElement | null,
        openOverlay: (p: {x: number; y: number}) => {
            this.overlayService.openAtMouse(p);
        },
        getNodeDimension: (id: string) => this.nodeDimensionService.getDimension(id)()
    });

    private arcController = new ArcDrawingController<ReachabilityNode, ReachabilityEdge>({
        getSelectedTool: () => this.selectedTool(),
        isNodeEligible: (n) => n.kind === 'state',
        isValidEdge: (_a, _b) => true,
        createEdge: (s, t) => new ReachabilityEdge(s, t, 't'),
        getNodes: () => this.graph()?.nodes ?? [],
        getEdges: () => this.visualEdges(),
        addEdge: (edge) => {
            const g = this.graph();
            if (!g) {
                return;
            }

            const edgeKey = getEdgeKey(edge.source.id, edge.target.id);
            const edgeAlreadyExists = g.edges.some(e => e.source.id === edge.source.id && e.target.id === edge.target.id);

            if (edgeAlreadyExists) {
                this.edgeToEdit.set(edgeKey);
                // Reset nach kurzem Delay, damit das Signal erkannt wird und beim nächsten Mal wieder feuert
                setTimeout(() => this.edgeToEdit.set(null), 500);
            } else {
                this.graph.set(new ReachabilityGraph(g.nodes, [...g.edges, edge]));
            }
        },
        addNodeAt: (x: number, y: number, _source: ReachabilityNode) => {
            return this.createStateNode(x, y);
        },
        findSvgForEventTarget: (target) => (target as Element | null)?.closest('svg') as SVGSVGElement | null,
        getNodeDimension: (id: string) => this.nodeDimensionService.getDimension(id)()
    });

    constructor() {
        // Canvas auto-resize canvas Logik
        effect(() => {
            const graph = this.graph();
            if (!graph) {
                return;
            }

            let maxY = 0;
            for (const node of graph.nodes) {
                const y = node.y();
                const dim = this.nodeDimensionService.getDimension(node.id)();
                const bottomY = y + calculateNodeMargins(node.kind, dim).bottom;

                if (bottomY > maxY) {
                    maxY = bottomY;
                }
            }
            this.resizeController.adjustHeight(maxY);
        });

        // Erreichbarkeitsgraph aus Service übernehmen (falls extern gesetzt)
        this.displayService.reachabilityGraph$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(graph => {
            this.graph.set(graph);
            if (graph.nodes.length === 0) {
                this.setInitialReachabilityGraph(this.displayService.diagram());
            }
        });

        effect(() => {
            // Bei jeder Änderung des Diagramms die Startmarkierung ableiten
            this.displayService.petriNetNonCoordinateChange(); // Abhängigkeit des effect, NICHT ENTFERNEN
            untracked(() => {
                this.setInitialReachabilityGraph(this.displayService.diagram());
                this.displayService.reachabilityPetriNetPreview.set(this.displayService.diagram().clone());
            });
        });

        effect(() => {
            const graph = this.graph();
            const diagram = this.displayService.diagram();
            if (graph && diagram) {
                const validationResult = this.validate();
                const showHints = untracked(() => this.showHints());

                if (validationResult.status !== 'success') {
                    this.lastSuccessGraphHash = null;
                }

                if (showHints && validationResult.status === 'success' && graph.nodes.length > 1) {
                    const currentHash = graph.getNonCoordinateHash();
                    if (currentHash !== this.lastSuccessGraphHash) {
                        this.snackbarService.showSnackbar(validationResult.message, validationResult.status);
                        this.validationService.clearValidationResult('Reachability Graph');
                        this.lastSuccessGraphHash = currentHash;
                    }
                }
            }
        });

        effect(() => {
            const preview = this.displayService.reachabilityPetriNetPreview(); // Abhängigkeit des effect, NICHT ENTFERNEN
            untracked(() => {
                if (preview) {
                    this.transitionValidationService.markActivatedTransition(preview);
                }
            });
        });

        effect(() => {
            // Wenn aktive Node ungültig wird, auf Initialknoten wechseln
            const active = this.activeNode();
            if (active && active.validity()?.status === 'invalid') {
                untracked(() => {
                    const graph = this.graph();
                    const init = this.reachabilityService.findInitialNode(graph);
                    if (init && init.id !== active.id) {
                        active.setActivated(false);
                        init.setActivated(true);
                    }
                });
            }
        });

        effect(() => {
            const active = this.activeNode();
            untracked(() => {
                const graph = this.graph();
                if (graph) {
                    graph.nodes.forEach(n => n.setActivated(n === active));
                }

                const preview = this.displayService.reachabilityPetriNetPreview();
                if (active) {
                    const marking = active.marking();
                    let hasOmega = false;
                    for (const node of preview.nodes) {
                        if (node.kind === 'place') {
                            const val = marking[node.id];
                            if (val === 'w') {
                                hasOmega = true;
                                (node as DiagramNode).tokenCount = 999;
                            } else {
                                (node as DiagramNode).tokenCount = val;
                            }
                        }
                    }
                    this.transitionValidationService.markActivatedTransition(preview);

                    if (hasOmega) {
                        this.infinityHint.set({
                            message: 'The marking of this state contains omega (w). The token counts might be inaccurate.',
                        });
                    } else {
                        this.infinityHint.set(undefined);
                    }
                }
            });
        });

        effect(() => {
            const previewPetriNet = this.displayService.reachabilityPetriNetPreview();
            const hint = this.infinityHint();
            const showHints = this.showHints();
            const tokenGameEnabled = this.displayService.reachabilityTokenGameEnabled();

            untracked(() => {
                if (previewPetriNet && tokenGameEnabled) {
                    previewPetriNet.hint = showHints ? hint : undefined;
                }
            });
        });

        effect(() => {
            // Reagieren auf gefeuerte Transitionen im Reachability-Kontext
            const fired = this.transitionValidationService.firedTransitionsReachability();

            untracked(() => {
                if (fired.length === 0) {
                    return;
                }
                const transitionLabel = fired[fired.length - 1]; // Letzte gefeuerte Transition
                const graph = this.graph();
                const active = this.activeNode();
                const diagram = this.displayService.diagram();

                if (!graph || !active) {
                    return;
                }

                // Nächsten Schritt im Graphen generieren
                const result = this.reachabilityGenerator.performStep(graph, active, transitionLabel, diagram);
                if (result) {
                    this.graph.set(result.graph);
                    graph.setNodeActivated(result.newNode);
                    this.applyLayout();
                }
            });
        });

        this.validationService.validationRequest$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(results => {
            const validationResult = this.validate();
            if (validationResult.status !== 'success') {
                const isInitialMarkingOnly = this.graph()
                    && this.graph()!.nodes.length <= 1 // nur die Startmarkierung
                    && this.graph()!.edges.length === 0 // keine Kanten
                    && Object.values(this.graph()!.nodes[0].markingValidity()).every(validity => validity?.status === 'valid'); // Startmarkierung wurde nicht verändert
                if (isInitialMarkingOnly) {
                    results.set('Reachability Graph', {status: 'info', message: 'No reachability graph given.'});
                    return;
                }
            }
            results.set('Reachability Graph', validationResult);
        });
    }

    ngOnDestroy(): void {
        this.arcController.destroy();
        this.eraserController.destroy();
    }

    private setInitialReachabilityGraph(diagram: Diagram) {
        this.validationService.clearValidationResult('Reachability Graph');

        const placeNodes = diagram.nodes.filter(n => n.kind === 'place');
        if (placeNodes.length === 0) {
            this.graph.set(undefined);
            return;
        }
        const marking = diagram.getMarking();
        const initialNode = new ReachabilityNode('s0', marking, 150, 200, true);
        initialNode.setActivated(true);
        this.graph.set(new ReachabilityGraph([initialNode], []));
    }

    clearCanvas() {
        this.displayService.displayReachabilityGraph(null);
        this.selectedTool.set(undefined);
        this.validationService.clearValidationResult('Reachability Graph');
    }

    public validate(): ValidationResult {
        const graph = this.graph();
        const diagram = this.displayService.diagram();
        if (!diagram || !graph) {
            return {status: 'error', message: 'No diagram or graph'};
        }
        const result = this.reachabilityValidationService.validateReachabilityGraph(graph, diagram);
        if (result) {
            return {status: 'error', message: result};
        }
        return {status: 'success', message: 'The reachability graph is complete and correct.'};
    }

    onNodePointerDown(event: PointerEvent, node: ReachabilityNode) {
        this.arcController.onNodePointerDown(event, node);
    }

    onCanvasPointerDown(event: PointerEvent) {
        this.eraserController.onCanvasPointerDown(event);
        this.panningController.onPointerDown(event);
    }

    onCanvasPointerMove(event: PointerEvent) {
        this.panningController.onPointerMove(event);
    }

    onCanvasPointerUp(event: PointerEvent) {
        this.panningController.onPointerUp(event);
        this.onCanvasPointerUpLightbulb(event);
    }

    onCanvasPointerUpLightbulb(event: MouseEvent) {
        this.lightbulbController.onCanvasMouseEventLightbulb(event);
    }

    generateGraph() {
        const diagram = this.displayService.diagram();
        if (!diagram) {
            return;
        }
        const generated = this.reachabilityGenerator.generateReachabilityGraph(diagram);
        this.reachabilityLayoutService.applyLayout(generated);
        this.graph.set(generated);
    }

    applyLayout() {
        const graph = this.graph();
        if (!graph) {
            return;
        }
        this.reachabilityLayoutService.applyLayout(graph);
        // Re-set graph to trigger signal update
        this.graph.set(new ReachabilityGraph(graph.nodes, graph.edges));
    }

    private updateMultiEdgeLabel(originalEdges: ReachabilityEdge[], newLabel: string | undefined, source: ReachabilityNode, target: ReachabilityNode, waypoints: Coords[]) {
        const labels = newLabel ? newLabel.split(',').map(s => s.trim()).filter(s => s.length > 0) : [];

        const currentGraph = this.graph();
        if (!currentGraph) {
            return;
        }

        const newEdgesForGroup = labels.map(l => new ReachabilityEdge(source, target, l, waypoints));

        const allEdges = currentGraph.edges;
        const remainingEdges = allEdges.filter(e => !originalEdges.includes(e));

        const updatedEdges = [...remainingEdges, ...newEdgesForGroup];

        this.graph.set(new ReachabilityGraph(currentGraph.nodes, updatedEdges));
    }

    // -------------------- Node-Erzeugung --------------------

    private createStateNode(x: number, y: number): ReachabilityNode | undefined {
        const currentGraph = this.graph();
        if (!currentGraph) {
            return;
        }
        const newNode = new ReachabilityNode(this.reachabilityGenerator.getNextStateNodeId(currentGraph), {});
        newNode.setX(x);
        newNode.setY(y);
        this.graph.set(
            new ReachabilityGraph([...currentGraph.nodes, newNode], currentGraph.edges)
        );
        return newNode;
    }

    isEdgeToEdit(edge: ReachabilityEdge): boolean {
        const key = getEdgeKey(edge.source.id, edge.target.id);
        return this.edgeToEdit() === key;
    }

}
