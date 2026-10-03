import {HttpClient} from '@angular/common/http';
import {Component, computed, effect, ElementRef, input, model, OnDestroy, output, signal, viewChildren} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatIcon} from '@angular/material/icon';
import {MatTooltip} from '@angular/material/tooltip';
import {catchError, of, take} from 'rxjs';
import {Diagram} from '../../classes/diagram/diagram';
import {DiagramEdge} from '../../classes/diagram/diagram-edge';
import {DiagramNode} from '../../classes/diagram/diagram-node';
import {DiagramHint, DiagramNodeKind, IDiagramNode} from '../../classes/diagram/diagram-types';
import {SvgDefsIdContextDirective} from '../../directives/svg-defs-id-context.directive';
import {DisplayService} from '../../services/display.service';
import {ExportService} from '../../services/export.service';
import {FileReaderService} from '../../services/file-reader.service';
import {NodeDimensionService} from '../../services/node-dimension.service';
import {OverlayEditService} from '../../services/overlay-edit.service';
import {OverlayService} from '../../services/overlay.service';
import {TabNavigationService} from '../../services/tab-navigation.service';
import {TransitionSequencesValidationService} from '../../services/transition-sequences-validation.service';
import {SketchModeController} from '../../sketch/sketch-mode.controller';
import {ArcDrawingController} from '../shared/arc-drawing.controller';
import {hitTest} from '../shared/canvas-helper';
import {CanvasPanningController} from '../shared/canvas-panning.controller';
import {CanvasResizeController} from '../shared/canvas-resize.controller';
import {DownloadButtonComponent} from '../shared/download-button/download-button.component';
import {EraserController} from '../shared/eraser.controller';
import {ExampleFileComponent} from '../shared/example-file/example-file.component';
import {LightbulbController} from '../shared/lightbulb.controller';
import {OverlayLabelInputComponent} from '../shared/overlay-label-input/overlay-label-input.component';
import {TokenGameToggleComponent} from '../shared/tokengame-toggle/token-game-toggle.component';
import {ToolType} from '../toolbar/tool.types';
import {SvgEdgeComponent} from './svg-edge/svg-edge.component';
import {calculateNodeMargins, PLACE_RADIUS, TRANSITION_HEIGHT, TRANSITION_WIDTH} from './svg-node/svg-node';
import {SvgNodeComponent} from './svg-node/svg-node.component';

@Component({
    selector: 'app-display',
    templateUrl: './display.component.html',
    providers: [NodeDimensionService, OverlayEditService],
    imports: [
        SvgNodeComponent,
        SvgEdgeComponent,
        SvgDefsIdContextDirective,
        MatButtonModule,
        MatIcon,
        MatTooltip,
        DownloadButtonComponent,
        TokenGameToggleComponent,
        OverlayLabelInputComponent
    ],
    styleUrls: ['./display.component.scss'],
    host: {
        '[class.eraser-active]': 'this.selectedTool() === "eraser"',
        '[class.lightbulb-active]': 'this.selectedTool() === "lightbulb"',
        '[class.sketch-active]': 'this.selectedTool() === "sketch"',
        '[class.readonly-mode]': 'this.readonlyMode()'
    }
})
export class DisplayComponent implements OnDestroy {

    readonly readonlyMode = input<boolean>(false);
    readonly allowTokenCountModification = input<boolean>(false);
    readonly allowEdgeWeightModification = input<boolean>(false);
    readonly allowEdgeLabelModification = input<boolean>(false);
    readonly dragAndDropEnabled = input<boolean>(false);
    readonly showHints = input<boolean>(true);
    readonly enforceUniqueLabels = input<boolean>(false);
    readonly selectedTool = input<ToolType | undefined>(undefined);
    readonly emptyDiagramMessage = input<string | undefined>(undefined);
    readonly undeletableNodes = input<string[]>([]);
    readonly fileContentChange = output<string>();
    readonly diagram = model<Diagram | null>(null);
    readonly tokenGameMode = input<boolean>(false);
    readonly resizable = input<boolean>(false);
    readonly tokenGameContext = input<'sequences' | 'process-net' | 'reachability'>();
    readonly hint = input<DiagramHint | undefined>(undefined);

    readonly nodeComponents = viewChildren(SvgNodeComponent);

    // WritableSignal für GhostNode speichert Mausposition, um diese Weiterzugeben - Werte werden laufend aktualisiert
    readonly ghostNode = signal<{kind: DiagramNodeKind; x: number; y: number} | null>(null);

    // Konstanten aus den Node-Komponenten,um Ghost-Nodes genauso (groß) zu zeichnen wie eigentliche Node
    readonly PLACE_RADIUS = PLACE_RADIUS;
    readonly TRANSITION_WIDTH = TRANSITION_WIDTH;
    readonly TRANSITION_HEIGHT = TRANSITION_HEIGHT;

    readonly resizeController = new CanvasResizeController();

    private readonly panningController = new CanvasPanningController({
        canStartPanning: () => {
            if (this.readonlyMode() || this.tokenGameMode() || (this.diagram()?.nodes?.length ?? 0) === 0) {
                return false;
            }
            if (!this.selectedTool()) {
                return true;
            }
            return this.selectedTool() === 'sketch' && this.displayService.sketchSubMode() === 'move';
        },
        diagram: () => this.diagram(),
        nodeDimensionService: this.nodeDimensionService
    });

    readonly canvasCursor = computed(() => {
        const hasNodes = (this.diagram()?.nodes?.length ?? 0) > 0;

        if (this.selectedTool() === 'sketch') {
            return this.displayService.sketchSubMode() === 'move' ? 'grab' : 'crosshair';
        }

        const canPan =
            hasNodes &&
            !this.readonlyMode() &&
            !this.tokenGameMode() &&
            !this.selectedTool();

        return canPan ? 'move' : undefined; // panning cursor
    });

    private eraserController = new EraserController<IDiagramNode, DiagramEdge>({
        getSelectedTool: () => this.selectedTool(),
        getNodes: () => {
            const nodes = this.diagram()?.nodes ?? [];
            const undeletable = this.undeletableNodes();
            if (undeletable.length === 0) {
                return nodes;
            }
            return nodes.filter(n => !undeletable.includes(n.id));
        },
        getEdges: () => this.diagram()?.edges ?? [],
        setDiagram: (nodes, edges) => {
            const currentDiagram = this.diagram();
            const undeletableNodeIds = this.undeletableNodes();
            const mergedNodes = [...nodes];
            if (currentDiagram && undeletableNodeIds.length > 0) {
                const undeletableNodes = currentDiagram.nodes.filter(n => undeletableNodeIds.includes(n.id));
                for (const node of undeletableNodes) {
                    if (!mergedNodes.some(n => n.id === node.id)) {
                        mergedNodes.push(node);
                    }
                }
            }
            this.diagram.set(new Diagram(mergedNodes, [...edges]));
        },
        findSvgForEventTarget: (target) => this.findSvgForEventTarget(target),
        getNodeDimension: (id: string) => this.nodeDimensionService.getDimension(id)()
    });

    private lightbulbController = new LightbulbController<IDiagramNode, DiagramEdge>({
        getSelectedTool: () => this.selectedTool(),
        getNodes: () => this.diagram()?.nodes ?? [],
        getEdges: () => this.diagram()?.edges ?? [],
        findSvgForEventTarget: (target) => this.findSvgForEventTarget(target),
        openOverlay: (p: {x: number; y: number}) => {
            this.overlayService.openAtMouse(p);
        },
        getNodeDimension: (id: string) => this.nodeDimensionService.getDimension(id)()
    });


    private arcController = new ArcDrawingController<IDiagramNode, DiagramEdge>({
        getSelectedTool: () => this.selectedTool(),
        isNodeEligible: (n) => n.kind === 'place' || n.kind === 'transition',
        isValidEdge: (a, b) => this.isValidArc(a, b) && !this.isDuplicate(a, b),
        createEdge: (s, t) => new DiagramEdge(s, t),
        getNodes: () => this.diagram()?.nodes ?? [],
        getEdges: () => this.diagram()?.edges ?? [],
        addEdge: (edge) => {
            const d = this.diagram();
            if (!d) {
                return;
            }
            this.diagram.set(new Diagram(d.nodes, [...d.edges, edge]));
        },
        addNodeAt: (x: number, y: number, source: IDiagramNode) => {
            const newKind = source.kind === 'place' ? 'transition' : 'place';
            return this.addNodeAt(newKind, x, y);
        },
        findSvgForEventTarget: (target) => this.findSvgForEventTarget(target),
        getNodeDimension: (id: string) => this.nodeDimensionService.getDimension(id)()
    });

    protected sketchController = new SketchModeController({
        getSelectedTool: () => this.selectedTool(),
        getDiagram: () => this.diagram(),
        setDiagram: (d) => this.diagram.set(d),
        findSvgForEventTarget: (target) => this.findSvgForEventTarget(target),
        getNodeDimension: (id: string) => this.nodeDimensionService.getDimension(id)(),
        startEditingNodeLabel: (id) => this.startEditingNodeLabel(id),
        saveHistoryStep: () => this.displayService.saveHistoryStep(),
        undo: () => this.displayService.undo(),
        redo: () => this.displayService.redo(),
        getSubMode: () => this.displayService.sketchSubMode()
    });

    // eslint-disable-next-line max-params
    constructor(private fileReaderService: FileReaderService,
                private http: HttpClient,
                protected tabNavigation: TabNavigationService,
                private exportService: ExportService,
                private nodeDimensionService: NodeDimensionService,
                private transitionSequenceService: TransitionSequencesValidationService,
                private readonly overlayService: OverlayService,
                protected readonly displayService: DisplayService,
                private readonly elementRef: ElementRef) {
        const hostEl = this.elementRef.nativeElement as HTMLElement;
        hostEl.addEventListener('touchmove', (e: Event) => {
            // Standardverhalten von Mobile-Browsern bei schnell aufeinanderfolgenden Touch-Aktionen unterbinden, damit alle touch events von der Anwendung selbst behandelt
            // werden können
            e.preventDefault();
        }, {passive: false});

        // effect() leert beim Werkzeugwechsel das Signal "ghostNode"
        effect(() => {
            const tool: ToolType | undefined = this.selectedTool();
            if (tool !== 'place' && tool !== 'transition') {
                this.ghostNode.set(null);
            }
        });

        effect(() => {
            if (this.displayService.sketchSubMode() === 'move') {
                this.sketchController.clearSelection();
            }
        });

        // Canvas auto-resize canvas Logik
        effect(() => {
            const diagram = this.diagram();
            if (!diagram || !this.resizable()) {
                return;
            }
            let maxY = 0;
            for (const node of diagram.nodes) {
                const bottomY = node.y() + calculateNodeMargins(node.kind).bottom;

                if (bottomY > maxY) {
                    maxY = bottomY;
                }
            }

            this.resizeController.adjustHeight(maxY);
        });
    }

    ngOnDestroy(): void {
        this.arcController.destroy();
        this.eraserController.destroy();
        this.sketchController.destroy();
    }

    // -------------------- Datei-Drop --------------------
    public processDropEvent(e: DragEvent) {
        if (this.readonlyMode() || this.tokenGameMode()) {
            return;
        }
        e.preventDefault();

        const fileLocation = e.dataTransfer?.getData(ExampleFileComponent.META_DATA_CODE);

        if (fileLocation) {
            this.fetchFile(fileLocation);
        } else {
            this.readFile(e.dataTransfer?.files);
        }
    }

    public prevent(e: DragEvent) {
        // dragover must be prevented for drop to work
        e.preventDefault();
    }

    private fetchFile(link: string) {
        this.http.get(link, {
            responseType: 'text'
        }).pipe(
            catchError(err => {
                console.error('Error while fetching file from link', link, err);
                return of(undefined);
            }),
            take(1)
        ).subscribe(content => {
            this.emitFileContent(content);
        });
    }

    private readFile(files: FileList | undefined | null) {
        if (!files || files.length === 0) {
            return;
        }
        this.fileReaderService.readFile(files[0]).pipe(take(1)).subscribe(content => {
            this.emitFileContent(content);
        });
    }

    private emitFileContent(content: string | undefined) {
        if (content === undefined) {
            return;
        }
        this.fileContentChange.emit(content);
    }

    // -------------------- Node-Erzeugung / Eraser / Lightbulb --------------------
    onCanvasPointerDown(event: PointerEvent) {
        if (!event.isPrimary) {
            return;
        }
        if (this.readonlyMode() || this.tokenGameMode()) {
            return;
        }
        if (this.selectedTool() === 'sketch') {
            const active = document.activeElement;
            if (active && active instanceof HTMLInputElement && active !== event.target) {
                active.blur();
            }

            const isPen = event.pointerType === 'pen';
            const isMoveMode = this.displayService.sketchSubMode() === 'move';

            if (!isPen && isMoveMode) {
                const svg = this.findSvgForEventTarget(event.currentTarget);
                const diagram = this.diagram();
                const hitNode = svg && diagram
                    ? diagram.nodes.find(n => hitTest(svg, n, event.clientX, event.clientY, this.nodeDimensionService.getDimension(n.id)(), true))
                    : null;

                if (hitNode) {
                    this.sketchController.startDirectDrag(event, hitNode);
                } else {
                    this.panningController.onPointerDown(event);
                }
                return;
            }

            this.sketchController.onCanvasPointerDown(event);
        } else if (this.selectedTool() === 'eraser') {
            this.eraserController.onCanvasPointerDown(event);
        } else {
            this.panningController.onPointerDown(event);
        }
    }

    onCanvasClick(event: MouseEvent) {
        if (this.readonlyMode() || this.tokenGameMode()) {
            return;
        }
        const tool = this.selectedTool();
        if (tool !== 'place' && tool !== 'transition') {
            return;
        }
        if (event.target !== event.currentTarget) {
            return;
        }
        const svg = event.currentTarget as SVGSVGElement;
        const box = svg.getBoundingClientRect();
        const x = event.clientX - box.left;
        const y = event.clientY - box.top;
        this.addNodeAt(tool, x, y);
    }

    onCanvasPointerUpLightbulb(event: MouseEvent) {
        this.lightbulbController.onCanvasMouseEventLightbulb(event);
    }

    onCanvasPointerUp(event: PointerEvent) {
        if (!event.isPrimary) {
            return;
        }
        this.panningController.onPointerUp(event);
        this.onCanvasPointerUpLightbulb(event);
    }

    private addNodeAt(kind: 'place' | 'transition', x: number, y: number): DiagramNode | undefined {
        const currentDiagram = this.diagram();
        if (!currentDiagram) {
            return;
        }
        const existingIds = new Set(currentDiagram.nodes.map(node => node.id));
        const existingEffectiveLabels = this.enforceUniqueLabels()
            ? new Set(currentDiagram.nodes.map(node => node.effectiveLabel()))
            : new Set<string>();
        const newNodeId = this.generateNodeId(existingIds, existingEffectiveLabels, kind);
        const newNode = new DiagramNode(newNodeId, kind, x, y);
        const updatedNodes = [...currentDiagram.nodes, newNode];
        this.diagram.set(new Diagram(updatedNodes, currentDiagram.edges));
        return newNode;
    }

    private generateNodeId(existingIds: Set<string>, existingEffectiveLabels: Set<string>, kind: 'place' | 'transition') {
        const prefix = kind === 'place' ? 'p' : 't';
        let counter = 1;
        let candidate = `${prefix}${counter}`;
        while (existingIds.has(candidate) || existingEffectiveLabels.has(candidate)) {
            counter += 1;
            candidate = `${prefix}${counter}`;
        }
        return candidate;
    }

    // -------------------- Node-GhostNode --------------------

    // Während Cursor über Canvas bewegt wird, wird Ghost-Node aktualisiert
    // damit sie immer direkt unter dem Cursor liegt

    onCanvasPointerMove(event: PointerEvent): void {
        if (!event.isPrimary) {
            return;
        }
        if (this.readonlyMode() || this.tokenGameMode()) {
            return;
        }

        this.panningController.onPointerMove(event);
        if (this.panningController.isPanning()) {
            return;
        }

        const tool: ToolType | undefined = this.selectedTool();
        if (tool !== 'place' && tool !== 'transition') {
            return;
        }
        const svg = event.currentTarget as SVGSVGElement | null;
        if (!svg) {
            return;
        }
        const diagram = this.diagram();
        // --------- Ghost Node ausgeblendet, wenn Cursor auf existierende Node im Canvas trifft -----------
        const hoveredNode = diagram?.nodes.find(node => hitTest(svg, node, event.clientX, event.clientY, this.nodeDimensionService.getDimension(node.id)()));
        if (hoveredNode) {
            // keine Werte in Writable ghostNode
            this.ghostNode.set(null);
            return;
        }
        const box = svg.getBoundingClientRect();
        const x = event.clientX - box.left;
        const y = event.clientY - box.top;
        this.ghostNode.set({kind: tool, x, y});
    }

    // -------------------- Delegation an ArcController --------------------
    onNodePointerDown(event: PointerEvent, node: IDiagramNode) {
        if (this.readonlyMode() || this.tokenGameMode()) {
            return;
        }
        if (this.selectedTool() === 'sketch') {
            const isPen = event.pointerType === 'pen';
            const isMoveMode = this.displayService.sketchSubMode() === 'move';

            if (!isPen && isMoveMode) {
                this.sketchController.startDirectDrag(event, node);
                return;
            }
            this.sketchController.onNodePointerDown(event);
        } else {
            this.arcController.onNodePointerDown(event, node);
        }
    }

    private isValidArc(a: IDiagramNode, b: IDiagramNode) {
        if (a.id === b.id) {
            return false;
        }
        const aIsPlace = a.kind === 'place';
        const bIsPlace = b.kind === 'place';
        const aIsTransition = a.kind === 'transition';
        const bIsTransition = b.kind === 'transition';
        return (aIsPlace && bIsTransition) || (aIsTransition && bIsPlace);
    }

    private isDuplicate(a: IDiagramNode, b: IDiagramNode) {
        const d = this.diagram();
        if (!d) {
            return false;
        }
        return d.edges.some(ed => ed.source.id === a.id && ed.target.id === b.id);
    }


    private findSvgForEventTarget(target: EventTarget | null) {
        return (target as Element | null)?.closest('svg') as SVGSVGElement | null;
    }

    private startEditingNodeLabel(nodeId: string) {
        const nodeComponent = this.nodeComponents().find(c => c.diagramNode()?.id === nodeId);
        if (nodeComponent) {
            nodeComponent.startLabelEditing();
        }
    }

    protected downloadDiagram() {
        this.exportService.openExportDialog(this.diagram());
    }

    handleTokenGame(event: Event, node: IDiagramNode) {
        if (!this.tokenGameMode() || this.readonlyMode()) {
            return;
        }
        event.stopPropagation();
        if (node.kind === 'transition' && node.activated()) {
            this.transitionSequenceService.fireTransition(this.diagram() as Diagram<DiagramNode, DiagramEdge<DiagramNode>>, <DiagramNode> node, true, this.tokenGameContext());
        }
    }

}
