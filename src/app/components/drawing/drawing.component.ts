import {AfterViewInit, Component, DestroyRef, effect, ElementRef, inject, OnDestroy, signal, Signal, untracked, viewChild} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {FormControl, ReactiveFormsModule} from '@angular/forms';
import {MatIcon} from '@angular/material/icon';
import {MatFormField, MatInput, MatLabel, MatSuffix} from '@angular/material/input';
import {MatTooltip} from '@angular/material/tooltip';
import {Diagram} from '../../classes/diagram/diagram';
import {DisplayService} from '../../services/display.service';
import {LayoutFrame, LayoutService} from '../../services/layout.service';
import {ParserService} from '../../services/parsing/parser.service';
import {PetriNetDefinitionNormalizationService} from '../../services/parsing/petri-net-definition-normalization.service';
import {PetriNetDefinitionParserService} from '../../services/parsing/petri-net-definition-parser.service';
import {SnackbarService} from '../../services/snackbar.service';
import {ValidationResult, ValidationService} from '../../services/validation.service';
import {DisplayComponent} from '../display/display.component';
import {ExampleFileComponent} from '../shared/example-file/example-file.component';
import {ToolType} from '../toolbar/tool.types';
import {ToolboxComponent} from '../toolbar/toolbox.component';

@Component({
    selector: 'app-drawing',
    imports: [
        DisplayComponent,
        ExampleFileComponent,
        MatFormField,
        MatLabel,
        ReactiveFormsModule,
        MatInput,
        ToolboxComponent,
        MatTooltip,
        MatIcon,
        MatSuffix
    ],
    templateUrl: './drawing.component.html',
    styleUrl: './drawing.component.scss'
})
export class DrawingComponent implements AfterViewInit, OnDestroy {

    private destroyRef = inject(DestroyRef);
    // Signal aus Service direkt nutzen
    readonly showHints = this.displayService.showHints;
    // Gegebene Defintion des PetriNets, das gezeichnet werden soll
    readonly givenPnCtrl = new FormControl<string>({value: '', disabled: false});

    displayElement: Signal<ElementRef<HTMLElement> | undefined> = viewChild(DisplayComponent, {read: ElementRef});

    petriNetDefinitionControl = new FormControl('');
    petriNetInput = viewChild<ElementRef<HTMLInputElement>>('petriNetInput');


    // "selectedTool" wird als Signal gespeichert, damit wir den aktuell
    // gewählten Werkzeug-Status unkompliziert sowohl an die Anzeige als auch
    // an andere Kind-Komponenten weiterreichen können. Die Toolbox meldet den
    // Wert über ihr Output-Ereignis. Standardmäßig ist kein Werkzeug aktiv,
    // weshalb wir mit "undefined" starten.
    readonly selectedTool = signal<ToolType | undefined>(undefined);


    /**
     *  Handle für die zeitgesteuerte Wiedergabe der LayoutFrames.
     *  Wird beim Diagram-Wechsel zurückgesetzt, damit keine Animation aus einem alten Netz weiterläuft.
     */
    private layoutAnimationHandle: number | null = null;

    // eslint-disable-next-line max-params
    constructor(private parserService: ParserService,
                protected displayService: DisplayService,
                private validationService: ValidationService,
                private petriNetDefinitionParser: PetriNetDefinitionParserService,
                private snackbarService: SnackbarService,
                private layoutService: LayoutService,
                private pnParser: PetriNetDefinitionParserService,
                private pnNormalizer: PetriNetDefinitionNormalizationService) {
        // Jede Änderung im Diagram triggert update der Petrinet-Definition (außer Koordinatenänderungen)
        effect(() => {
            const {diagram} = this.displayService.petriNetNonCoordinateChange();
            const showHints = this.displayService.showHints();
            // kein/leeres Netz
            untracked(() => {
                if (!diagram || diagram.nodes.length === 0) {
                    if (this.petriNetDefinitionControl.valid) {
                        this.clearPetriNetDefinitionControl();
                    }
                    return;
                }

                if (showHints) {
                    const definition = this.petriNetDefinitionParser.toDefinition(diagram);
                    this.petriNetDefinitionControl.setValue(definition ?? '');
                } else {
                    this.clearPetriNetDefinitionControl();
                }
            });
        });

        /**
         * live-sync:
         * wenn interne PN-Definition (IST-Defintion des Diagrams) aktualisiert wird und showHints()===true
         * -> aktuelle Defintion sofort in Input-Feld sichtbar
         */
        effect(() => {
            const showHints = this.displayService.showHints();
            if (showHints) {
                this.givenPnCtrl.disable({emitEvent: false});
            } else {
                this.givenPnCtrl.enable({emitEvent: false});
            }
        });

        this.validationService.validationRequest$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(results => {
            results.set('Petri Net', this.validateAgainstGivenPetriNet());
        });
    }

    ngAfterViewInit(): void {
        // Autofocus, aber ohne die Website z. B. auf Mobilgeräten direkt nach unten zu scrollen
        this.petriNetInput()?.nativeElement.focus({preventScroll: true});
    }

    ngOnDestroy() {
        this.clearLayoutAnimation();
    }

    applyLayout() {
        const diagram = this.displayService.diagram();
        if (diagram) {
            const frames: LayoutFrame[] = [];
            this.layoutService.applyForceDirectedLayout(diagram, {frames, width: this.canvasWidth()});
            this.playLayoutAnimation(diagram);
        }
    }

    clearCanvas() {
        this.displayService.display(null);
        this.displayService.clearHistory();
        this.selectedTool.set(undefined);
        this.clearPetriNetDefinitionControl();
        this.validationService.clearValidationResult('Petri Net');
    }

    processSourceChange(newSource: string) {
        const result = this.parserService.parse(newSource, this.canvasWidth());
        if (result) {
            if (typeof result !== 'string') {
                this.displayService.display(result);
                this.displayService.clearHistory();
                this.playLayoutAnimation(result);
                this.clearPetriNetDefinitionControl();
                return;
            } else {
                this.snackbarService.showSnackbar(result, 'error');
            }
        }
        this.clearPetriNetDefinitionControl();
        this.displayService.display(null);
        this.displayService.clearHistory();
    }

    showPetriNet() {
        let definition = this.petriNetDefinitionControl.value;
        if (!definition || definition.trim().length === 0) {
            definition = '({p1,p2},{t1},2x(p1,t1)+(t1,p2),3xp1)';
            this.petriNetDefinitionControl.setValue(definition);
        }
        definition = definition.normalize('NFKC');

        const result = this.petriNetDefinitionParser.parse(definition);

        if (result && typeof result !== 'string') {
            // hier direkte Berechnung des Layouts, damit Editor direkt nach Parsen ein gut gelayoutetes Petrinetz anzeigen kann
            // Frames ermöglichen Animation des Layout-Buildings
            const frames: LayoutFrame[] = [];
            this.layoutService.applyForceDirectedLayout(result as unknown as Diagram, {frames, width: this.canvasWidth()});
            this.displayService.display(result);
            this.displayService.clearHistory();
            this.playLayoutAnimation(this.displayService.diagram());
            return;
        }
        const errorMessage = result || 'Invalid Petri net definition';
        this.snackbarService.showSnackbar(errorMessage, 'error');
        this.petriNetDefinitionControl.setErrors({message: errorMessage});
        this.petriNetDefinitionControl.markAsTouched();
        this.displayService.display(null);
        this.displayService.clearHistory();
    }

    private clearPetriNetDefinitionControl() {
        this.petriNetDefinitionControl.setValue('');
    }

    private canvasWidth(): number | undefined {
        return this.displayElement()?.nativeElement.getBoundingClientRect().width;
    }


    /**
     * Zentraler Einstiegspunkt zum Abspielen der Layout-Animation
     * Wird aufgerufen, wenn ein Diagram gealden/ersetzt wird, damit keine konkurrierenden Timer aktiv bleiben
     * Daher zuerst -> laufende Timer stoppen
     */
    private playLayoutAnimation(diagram: Diagram | null) {
        this.clearLayoutAnimation();
        // Frames stammen aus layout.service.ts, wenn sie fehlen -> keine Animation, da das Diagramm dann entweder manuell gesetzt wurde
        // oder statisches Fallback-Layout genutzt wird
        const frames = diagram?.layoutFrames;
        if (!diagram || !frames || frames.length === 0) {
            return;
        }
        // Mappen für schnelleren Zugriff auf die Knoten im Diagramm nach ID (statt teurere Array-Suche in jedem Frame)
        const nodesById = new Map(diagram.nodes.map(node => [node.id, node]));
        // zeitlicher Abstand zwischen den Frames ~33 FPS
        const stepDurationMs = 30;
        // Frame-Anwendung separat, damit initial anwendbar und aus dem Timeout heraus
        const applyFrame = (index: number) => {
            const frame = frames[index];
            if (!frame) {
                return; // falls Indizes inkosistent sind
            }
            for (const pos of frame.positions) {
                const node = nodesById.get(pos.id);
                if (node) {
                    // Koordinaten werden direkt gesetzt;
                    // keine Angular Change-Detection, da DiagramNode-Setter bereits Observables bedienen
                    node.setX(pos.x);
                    node.setY(pos.y);
                }
            }
        };
        // jeder Aufruf in der Timer-Kette wendet den aktuellen Frame an & plant den nächsten, bis alle angezeigt wurden
        let index = 0;
        const advance = () => {
            applyFrame(index);
            const currentFrame = frames[index];
            index += 1;
            if (index < frames.length) {
                // Dynamische Geschwindigkeit:
                // Wenn sich die Nodes kaum bewegen (kleines maxDisplacement), verkürzen wir die Wartezeit, damit die Animation nicht "einschläft".
                // Bei großen Bewegungen (z.B. > 10px) bleiben wir bei ~30ms.
                // Bei sehr kleinen Bewegungen (< 1px) gehen wir runter auf ~5ms.
                const displacement = currentFrame?.maxDisplacement ?? 10;
                const dynamicDelay = Math.max(1, Math.min(stepDurationMs, displacement * 3));

                // window.setTimeout, damit Lags nicht kumulieren können (wie bei setInterval) & Timing stabil bleibt
                this.layoutAnimationHandle = window.setTimeout(advance, dynamicDelay);
            }
        };
        // Animation starten (seperater Aufruf -> dadruch Frame 0 sofort sichtbar, bevor der erste Timer startet)
        advance();
    }

    /**
     *  Aufräumen aller laufender Layout-Animationen -> Verhindert, dass alte Timer weiterlaufen
     *  & mit neuen Diagrammen kollidieren -> Handle wird auf null gesetzt, zeigt: keine Animation aktiv
     */
    private clearLayoutAnimation() {
        if (this.layoutAnimationHandle !== null) {
            window.clearTimeout(this.layoutAnimationHandle);
            this.layoutAnimationHandle = null;
        }
    }

    public validateAgainstGivenPetriNet(): ValidationResult {
        const sollRaw = this.givenPnCtrl.value || '';
        const istRaw = this.pnParser.toDefinition(this.displayService.diagram());
        // Beide Seiten durch denselben Normalizer
        const normalizedSoll = this.pnNormalizer.normalize(sollRaw);
        const normalizedIst = this.pnNormalizer.normalize(istRaw);


        return this.globalValidationDrawing(sollRaw, normalizedSoll, normalizedIst);
    }

    private globalValidationDrawing(sollRaw: string, normalizedSoll: string | undefined, normalizedIst: string | undefined): ValidationResult {
        if (!this.displayService.diagram()) {
            const result = 'No Drawing provided to validate';
            return {status: 'error', message: result};
        }

        if (this.displayService.diagram().nodes.length === 0 && sollRaw.trim().length > 0) {
            const result = 'No Drawing provided to validate against entered Petri net';
            return {status: 'error', message: result};
        }

        if (!sollRaw || sollRaw.trim().length === 0) {
            const result = 'No petri net provided to validate against';
            return {status: 'info', message: result};
        }


        if (sollRaw.trim().length > 0 && normalizedSoll !== normalizedIst && this.displayService.diagram().nodes.length > 0) {
            const result = 'Drawing does not match the entered petri net';
            return {status: 'error', message: result};
        } else {
            const result = 'Drawing matches the entered petri net';
            return {status: 'success', message: result};
        }
    }

}
