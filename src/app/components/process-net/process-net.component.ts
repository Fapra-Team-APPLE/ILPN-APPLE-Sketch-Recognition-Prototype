import {Component, computed, DestroyRef, effect, inject, signal, untracked} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {FormControl, ReactiveFormsModule} from '@angular/forms';
import {MatAutocompleteModule} from '@angular/material/autocomplete';
import {MatFormField, MatLabel, MatSuffix} from '@angular/material/form-field';
import {MatIcon} from '@angular/material/icon';
import {MatInput} from '@angular/material/input';
import {MatTooltip} from '@angular/material/tooltip';
import {ProcessNetGeneratorService} from 'src/app/services/process-net/process-net-generator.service';
import {ProcessNetValidationService} from 'src/app/services/process-net/process-net-validation.service';
import {Diagram} from '../../classes/diagram/diagram';
import {DiagramHint} from '../../classes/diagram/diagram-types';
import {DisplayService} from '../../services/display.service';
import {getStartMarking, extractLinearizedSequence, isSameMarking, getMarkingFromDiagramNodes} from '../../services/process-net/process-net-utils';
import {ReachabilityGraphGeneratorService} from '../../services/reachability/reachability-graph-generator.service';
import {SnackbarService} from '../../services/snackbar.service';
import {TransitionSequencesValidationService} from '../../services/transition-sequences-validation.service';
import {ValidationResult, ValidationService} from '../../services/validation.service';
import {DisplayComponent} from '../display/display.component';
import {ToolType} from '../toolbar/tool.types';
import {ToolbarDividerComponent} from '../toolbar/toolbar-divider/toolbar-divider.component';
import {ToolboxTextButtonComponent} from '../toolbar/toolbox-text-button/toolbox-text-button.component';
import {ToolboxComponent} from '../toolbar/toolbox.component';


@Component({
    selector: 'app-process-net',
    imports: [
        MatFormField,
        MatLabel,
        MatInput,
        MatAutocompleteModule,
        ReactiveFormsModule,
        DisplayComponent,
        ToolboxComponent,
        ToolboxTextButtonComponent,
        ToolbarDividerComponent,
        MatIcon,
        MatSuffix,
        MatTooltip
    ],
    templateUrl: './process-net.component.html',
    styleUrl: './process-net.component.scss'
})
export class ProcessNetComponent {

    protected displayService = inject(DisplayService);
    private destroyRef = inject(DestroyRef);
    private snackbarService = inject(SnackbarService);
    private validationService = inject(ProcessNetValidationService);
    private generatorService = inject(ProcessNetGeneratorService);
    private globalValidationService = inject(ValidationService);
    private reachabilityGenerator = inject(ReachabilityGraphGeneratorService);
    private transitionSequencesService = inject(TransitionSequencesValidationService);

    readonly processNet = signal<Diagram | null>(null);
    readonly infinityHint = signal<DiagramHint | undefined>(undefined);

    private lastSuccessGraphHash: string | null = null;

    readonly undeletableNodeIds = computed(() => {
        const originalPetriNet = this.displayService.diagram();
        if (!originalPetriNet) {
            return [];
        }
        const startMarking = getStartMarking(originalPetriNet);
        let count = 0;
        for (const c of startMarking.values()) {
            count += c;
        }
        return Array.from({length: count}, (_, i) => `b${i + 1}`);
    });

    readonly selectedTool = signal<ToolType | undefined>(undefined);
    readonly mandatoryTransitions = signal<string[]>([]);
    readonly validUniqueSequences = signal<string[]>([]);
    readonly mandatoryTransitionsControl = new FormControl<string>('');

    readonly filteredSequences = computed(() => {
        const input = (this.mandatoryTransitionsControl.value || '').toLowerCase();
        const sequences = this.validUniqueSequences();
        return sequences.filter(s => s.toLowerCase().includes(input));
    });

    constructor() {
        // Prozessnetz aus Service übernehmen (falls extern gesetzt)
        this.displayService.processNet$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(processNet => {
            this.processNet.set(processNet);
        });

        effect(() => {
            // Bei jeder Änderung des Petri-Netzes (außer Koordinatenänderungen): Komponente zurücksetzen
            this.displayService.petriNetNonCoordinateChange(); // Abhängigkeit des effect, NICHT ENTFERNEN
            untracked(() => {
                this.resetCanvas();
                this.calculateUniqueSequences();
            });
        });


        effect(() => {
            // Wenn sich das Prozessnetz ändert: Zustand des Petri-Netz-Previews (Markierung, aktivierte Transitionen) synchronisieren
            const processNet = this.processNet();

            untracked(() => {
                if (!processNet || processNet.nodes.length === 0) {
                    return;
                }

                // 1. Linearisierte Sequenz aus dem Prozessnetz extrahieren
                const sequence = extractLinearizedSequence(processNet);

                // 2. Prüfen, ob die aktuelle Sequenz (firedTransitionsProcessNet) davon abweicht
                const currentFired = this.transitionSequencesService.firedTransitionsProcessNet();

                // Einfacher String-Vergleich der Sequenzen
                if (sequence.join(' ') !== currentFired.join(' ')) {
                    // 3. Fired Transitions im Service aktualisieren
                    this.transitionSequencesService.lastUpdateSource.set('processNet');
                    this.transitionSequencesService.firedTransitionsProcessNet.set(sequence);


                    // 4. Preview Petri-Netz aktualisieren, indem die Transitionen in der extrahierten Reihenfolge gefeuert werden
                    const diagram = this.displayService.diagram();
                    const preview = diagram.clone();
                    for (const label of sequence) {
                        const transitionNode = preview.findNodeByEffectiveLabel(label, 'transition');
                        if (transitionNode) {
                            // record=false, da wir das Signal bereits oben gesetzt haben
                            this.transitionSequencesService.fireTransition(preview, transitionNode, false, 'process-net');
                        }
                    }
                    this.displayService.processNetPetriNetPreview.set(preview);
                }
            });
        });

        effect(() => {
            // Sobald eine Transition gefeuert wurde (Tokengame), müssen die aktivierten Transitionen neu berechnet werden und ggf. das Prozessnetz aktualisiert werden
            const fired = this.transitionSequencesService.firedTransitionsProcessNet();
            const source = this.transitionSequencesService.lastUpdateSource();
            const previewPetriNet = this.displayService.processNetPetriNetPreview();

            untracked(() => {
                if (previewPetriNet) {
                    this.transitionSequencesService.markActivatedTransition(previewPetriNet);
                }

                if (fired.length > 0 && source === 'tokenGame') {
                    const originalPetriNet = this.displayService.diagram();
                    const processNet = this.generatorService.generateProcessNet(originalPetriNet, fired, true);
                    this.displayService.displayProcessNet(processNet);
                }
            });
        });

        effect(() => {
            // Bei jeder Änderung der Sequenzen von Tab 2: recalculate
            this.transitionSequencesService.sequences();
            // Nur gültige Sequenzen anzeigen, wenn Show Hints aktiviert ist. Ansonsten alle.
            const showHints = this.displayService.showHints();
            untracked(() => {
                this.calculateUniqueSequences(showHints);
            });
        });

        effect(() => {
            const previewPetriNet = this.displayService.processNetPetriNetPreview();
            const hint = this.infinityHint();
            const showHints = this.displayService.showHints();

            untracked(() => {
                if (previewPetriNet) {
                    previewPetriNet.hint = showHints ? hint : undefined;
                }
            });
        });

        effect(() => {
            const processNet = this.processNet();
            const diagram = this.displayService.diagram();
            if (processNet && diagram) {
                const validationResult = this.validate();
                const showHints = untracked(() => this.displayService.showHints());

                if (validationResult.status !== 'success') {
                    this.lastSuccessGraphHash = null;
                }

                if (showHints && validationResult.status === 'success' && processNet.nodes.length > 1) {
                    const currentHash = processNet.getNonCoordinateHash();
                    if (currentHash !== this.lastSuccessGraphHash) {
                        this.snackbarService.showSnackbar(validationResult.message, validationResult.status);
                        this.globalValidationService.clearValidationResult('Process Net');
                        this.lastSuccessGraphHash = currentHash;
                    }
                }
            }
        });

        this.globalValidationService.validationRequest$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(results => {
            const validationResult = this.validate();
            if (validationResult.status !== 'success') {
                const processNet = this.processNet();

                const isInitialMarkingOnly = processNet
                    && processNet.nodes.length === this.undeletableNodeIds().length // nur die Startmarkierung
                    && processNet.edges.length === 0 // keine Kanten
                    && isSameMarking(getStartMarking(this.displayService.diagram()), getMarkingFromDiagramNodes(processNet.nodes)); // Startmarkierung wurde nicht verändert
                if (isInitialMarkingOnly) {
                    results.set('Process Net', {status: 'info', message: 'No Process net given!'});
                    return;
                }
            }
            results.set('Process Net', validationResult);
        });
    }

    resetCanvas() {
        this.transitionSequencesService.resetFiredTransitionsProcessNet();
        const diagram = this.displayService.diagram();

        this.displayService.processNetPetriNetPreview.set(diagram.clone());

        const reachabilityGraph = this.reachabilityGenerator.generateReachabilityGraph(diagram, {coverability: true});
        const hint = reachabilityGraph.getInfinityHint('process_net');
        this.infinityHint.set(hint);

        const initialProcessNet = this.generatorService.generateInitialProcessNet(diagram);
        this.displayService.displayProcessNet(initialProcessNet);

        this.selectedTool.set(undefined);
        this.mandatoryTransitionsControl.setValue('');
        this.mandatoryTransitions.set([]);
        this.globalValidationService.clearValidationResult('Process Net');
    }

    validate(showHint = true): ValidationResult {
        const processNet = this.processNet();
        if (processNet === null) {
            return {status: 'info', message: 'No Processnet given!'};
        }

        const originalPetriNet = this.displayService.diagram();

        const mandatoryTransitions = this.mandatoryTransitions();
        if (mandatoryTransitions.length > 0) {
            const transitionValidationResult = this.validationService.validateMandatoryTransitions(originalPetriNet, mandatoryTransitions);
            if (transitionValidationResult.status === 'invalid') {
                return {
                    status: 'error',
                    message: transitionValidationResult.message || 'Invalid mandatory transitions!',
                    hint: transitionValidationResult.hint
                };
            }
        }

        const validationResult = this.validationService.validate(processNet, originalPetriNet, mandatoryTransitions);
        if (validationResult.status === 'valid-complete') {
            if (mandatoryTransitions.length > 0) {
                return {status: 'success', message: 'Process net is valid and contains all mandatory transitions.'};
            }
            return {status: 'success', message: 'Process net is valid and complete.'};
        } else if (validationResult.status === 'valid-incomplete') {
            // valid-incomplete kann nur auftreten, wenn keine mandatoryTransitions angegeben wurden
            let message = 'Process net is valid but NOT complete.';
            if (showHint && validationResult.message) {
                message = validationResult.message;
            }
            if (this.infinityHint()) {
                return {
                    status: 'warning',
                    message: 'Process net is valid but NOT complete. The underlying Petri net is unbounded or has cycles, so completeness cannot be guaranteed.',
                    hint: validationResult.hint
                };
            }
            return {status: 'error', message, hint: validationResult.hint};
        } else {
            let message = 'Process net is invalid.';
            if (showHint && validationResult.message) {
                message = validationResult.message;
            }
            return {status: 'error', message, hint: validationResult.hint};
        }
    }

    generateProcessNet() {
        const originalPetriNet = this.displayService.diagram();
        if (!originalPetriNet || originalPetriNet.nodes.length === 0 || Array.from(getStartMarking(originalPetriNet).values()).reduce((a, b) => a + b, 0) === 0) {
            this.snackbarService.showSnackbar('You need to have a Petri net with at least one initial marking place', 'error');
            return;
        }

        const processNet = this.generatorService.generateProcessNet(originalPetriNet, this.mandatoryTransitions());
        this.processNet.set(processNet);
    }

    onInputChange(value: string) {
        if (!value || !value.trim()) {
            this.mandatoryTransitions.set([]);
            return;
        }

        // Überprüfe die Mandatory Transition immer
        for (const transitionName of value.split(' ')) {
            if (!transitionName) {
                continue;
            }
            const transition = this.displayService.diagram().findNodeByEffectiveLabel(transitionName, 'transition');
            if (!transition) {
                this.mandatoryTransitionsControl.setErrors({message: 'Transition "' + transitionName + '" does not exist in the Petri net.'});
                this.mandatoryTransitionsControl.markAsTouched();
                break;
            }
        }

        // Parse komma- oder leerzeichen-getrennte Transitionsnamen
        // Behalte die Reihenfolge bei - erste hat höchste Priorität
        const transitionNames = value
            .split(/[,\s]+/)
            .map(t => t.trim())
            .filter(t => t.length > 0);

        this.mandatoryTransitions.set(transitionNames);
    }

    private calculateUniqueSequences(onlyIncludeValidSequences: boolean = true) {
        const diagram = this.displayService.diagram();
        const sequences = this.transitionSequencesService.sequences();

        if (sequences.length === 0) {
            this.validUniqueSequences.set([]);
            return;
        }

        const uniqueSequenceSet = new Set<string>();
        const resultSequences: string[] = [];

        for (const sequence of sequences) {
            const transitions = sequence.trim().split(/\s+/).filter(t => t.length > 0);

            const validationDiagram = diagram.clone();
            const validationResult = this.transitionSequencesService.validateTransitionSequenceDetailed(validationDiagram, sequence);
            const isValid = validationResult.every(r => r.valid);

            if (isValid || !onlyIncludeValidSequences) {
                const uniqueTransitions = [...new Set(transitions)];
                const setKey = [...uniqueTransitions].sort().join(' ');

                if (!uniqueSequenceSet.has(setKey)) {
                    uniqueSequenceSet.add(setKey);
                    resultSequences.push(uniqueTransitions.join(' '));
                }
            }
        }

        this.validUniqueSequences.set(resultSequences);
    }

}
