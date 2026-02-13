import {DragDropModule} from '@angular/cdk/drag-drop';
import {ScrollingModule} from '@angular/cdk/scrolling';
import {AsyncPipe} from '@angular/common';
import {Component, effect, ElementRef, inject, signal, untracked, viewChild} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {FormArray, FormControl, FormGroup, ReactiveFormsModule} from '@angular/forms';
import {MatIconButton} from '@angular/material/button';
import {MatFormField, MatLabel} from '@angular/material/form-field';
import {MatIcon} from '@angular/material/icon';
import {MatInput} from '@angular/material/input';
import {MatTooltip} from '@angular/material/tooltip';
import {map, Observable, startWith} from 'rxjs';
import {DiagramHint} from '../../classes/diagram/diagram-types';
import {ReachabilityGraph} from '../../classes/reachability/reachability-graph';
import {ReachabilityNode} from '../../classes/reachability/reachability-node';
import {DisplayService} from '../../services/display.service';
import {ReachabilityGraphGeneratorService} from '../../services/reachability/reachability-graph-generator.service';
import {SnackbarService} from '../../services/snackbar.service';
import {TransitionSequencesValidationService} from '../../services/transition-sequences-validation.service';
import {ValidationResult, ValidationService, ValidationTargetId} from '../../services/validation.service';
import {DisplayComponent} from '../display/display.component';
import {ClearSequencesDialogComponent} from '../toolbar/delete-dialog/clear-sequences-dialog.component';
import {ToolboxTextButtonComponent} from '../toolbar/toolbox-text-button/toolbox-text-button.component';
import {ToolboxComponent} from '../toolbar/toolbox.component';

@Component({
    selector: 'app-transition-sequences',
    standalone: true,
    imports: [ReactiveFormsModule,
        MatFormField,
        MatLabel,
        MatIcon,
        MatInput,
        MatIconButton,
        DisplayComponent,
        DragDropModule,
        ScrollingModule,
        MatTooltip,
        ToolboxComponent,
        ToolboxTextButtonComponent,
        AsyncPipe
    ],
    templateUrl: './transition-sequences.component.html',
    styleUrl: './transition-sequences.component.scss',
    host: {
        '[class.hints-disabled]': '!displayService.showHints()'
    }
})
export class TransitionSequencesComponent {

    readonly showHints = this.displayService.showHints;

    private readonly firingSequenceInput = viewChild<ElementRef<HTMLInputElement>>('firingSequenceInput');

    private readonly reachabilityGenerator = inject(ReachabilityGraphGeneratorService);

    currentSequence = new FormControl<string>('');
    form = new FormGroup({
        sequences: new FormArray<FormControl<string>>([])
    });

    sequencesList$: Observable<FormControl<string>[]>;

    validationResults: Array<Array<{transition: string, valid: boolean}> | null> = [];

    isCurrentSequenceValid = false;
    currentValidationResult: {transition: string, valid: boolean}[] = [];

    protected infinityHint = signal<DiagramHint | undefined>(undefined);
    protected maxNumberOfSequences = signal<boolean>(false);
    private transitionSequencesValidationService = inject(TransitionSequencesValidationService);

    protected readonly ClearSequencesDialogComponent = ClearSequencesDialogComponent;

    constructor(private validationService: TransitionSequencesValidationService,
                public displayService: DisplayService,
                private snackbarService: SnackbarService,
                private globalValidationService: ValidationService) {
        this.sequencesList$ = this.sequences.valueChanges.pipe(
            startWith(null),
            map(() => [...this.sequences.controls])
        );

        this.validationService.resetFiredTransitions();

        this.globalValidationService.validationRequest$.pipe(takeUntilDestroyed()).subscribe((resultsMap) => {
            this.performGlobalValidation(resultsMap);
        });

        effect(() => {
            // Bei jeder Änderung des Petri-Netzes (außer Koordinatenänderungen): Komponente zurücksetzen
            this.displayService.petriNetNonCoordinateChange(); // Abhängigkeit des effect, NICHT ENTFERNEN
            untracked(() => this.resetSequences());
        });

        effect(() => {
            // Wenn sich das Preview-Petri-Netz ändert: aktivierte Transitionen im Preview-Petri-Netz markieren
            const preview = this.displayService.firingSequencesPetriNetPreview(); // Abhängigkeit des effect, NICHT ENTFERNEN
            untracked(() => this.validationService.markActivatedTransition(preview));
        });

        effect(() => {
            // Wenn sich die gefeuerten Transitionen ändern: prüfen, ob es eine externe Änderung war (durch Tokengame) und ggf. das Eingabefeld aktualisieren
            const fired = this.validationService.firedTransitions();
            untracked(() => {
                if (!this.displayService.showHints()) {
                    return;
                }
                const firedString = fired.join(' ');

                // Berechnen des gültigen Präfixes der aktuellen Eingabe, um zu entscheiden, ob ein Update erforderlich ist
                // Nur gültige Transitionen sind Teil des gültigen Präfixes, weil nach der ersten ungültigen Transition alle weiteren Transitionen als ungültig markiert werden
                const validPrefix = this.currentValidationResult
                    .filter(r => r.valid)
                    .map(r => r.transition)
                    .join(' ');

                // Wenn die gefeuerten Transitionen genau dem gültigen Präfix der aktuellen Eingabe entsprechen, dann stammt dieses Update wahrscheinlich von unserer eigenen
                // Validierungslogik (validateInput) oder ist konsistent mit dem aktuellen Eingabestatus. In diesem Fall aktualisieren wir den Eingabewert NICHT, um das
                // Überschreiben ungültiger Zeichen zu vermeiden (z.B. "A X" -> "A").
                if (firedString !== validPrefix) {
                    this.currentSequence.setValue(firedString);
                    // Änderung durch Tokengame -> Eingabefeld aktualisieren
                    this.onInputChange(this.currentSequence, this.currentSequence.value || '');
                    this.firingSequenceInput()?.nativeElement.focus();
                }
            });
        });

        effect(() => {
            // Wenn Show Hints aktiviert wird, den aktuellen Eingabewert validieren und den Preview-Petri-Netz-Zustand aktualisieren
            // Wenn Show Hints deaktiviert wird, das Preview-Petri-Netz auf den initialen Zustand zurücksetzen
            if (this.displayService.showHints()) {
                untracked(() => {
                    this.onInputChange(this.currentSequence, this.currentSequence.value || '');
                });
            } else {
                untracked(() => {
                    this.resetWorkingPetrinet();
                });
            }
        });

        effect(() => {
            // Hint auf dem Preview-Diagramm aktualisieren, wenn sich showHints oder das Diagramm ändert (Hint nur anzeigen, wenn showHints aktiv ist)
            const showHints = this.displayService.showHints();
            const preview = this.displayService.firingSequencesPetriNetPreview();
            const hint = this.infinityHint();

            untracked(() => {
                if (preview) {
                    preview.hint = showHints ? hint : undefined;
                }
            });
        });
    }


    get sequences(): FormArray<FormControl<string>> {
        return this.form.get('sequences') as FormArray<FormControl<string>>;
    }

    addCurrentSequence(): void {
        const value = this.currentSequence.value?.trim();
        if (value && (this.isCurrentSequenceValid || !this.displayService.showHints())) {
            const diagram = this.displayService.diagram();
            const canonicalValue = this.validationService.getCanonicalSequence(diagram, value);

            if (this.sequences.controls.some(c => this.validationService.getCanonicalSequence(diagram, c.value || '') === canonicalValue)) {
                this.snackbarService.showSnackbar('Transition sequence already exists!', 'error');
                return;
            }
            this.sequences.insert(0, new FormControl<string>(value) as FormControl<string>);
            this.validationService.addSequence(value);
            this.validationResults.unshift(this.currentValidationResult);
            this.currentSequence.setValue('');
            this.currentValidationResult = [];
            this.isCurrentSequenceValid = false;
            this.resetWorkingPetrinet();
            this.checkForCompletion();
        }
    }


    editRow(index: number): void {
        const value = this.sequences.at(index).value;
        this.currentSequence.setValue(value);
        this.removeRow(index);
        this.onInputChange(this.currentSequence, value || '');
    }

    removeRow(index: number): void {
        this.sequences.removeAt(index);
        this.validationService.removeSequence(index);
        this.validationResults.splice(index, 1);
    }

    onInputChange(control: FormControl<string | null>, value: string): void {
        const sanitized = this.sanitizeSequenceInput(value);

        if (sanitized !== value) {
            control.setValue(sanitized);
        }

        this.validateInput(sanitized);
    }

    private validateInput(sequence: string): void {
        if (!sequence.trim()) {
            this.currentValidationResult = [];
            this.isCurrentSequenceValid = false;
            if (this.displayService.showHints()) {
                this.displayService.firingSequencesPetriNetPreview.set(this.displayService.diagram().clone());
                this.validationService.firedTransitions.set([]);
            }
            return;
        }

        const diagram = this.displayService.diagram().clone();
        if (!diagram) {
            return;
        }

        this.currentValidationResult = this.validationService.validateTransitionSequenceDetailed(diagram, sequence);

        if (this.displayService.showHints()) {
            // Aktualisieren des Preview-Diagramms auf den Zustand nach dem Feuern gültiger Transitionen
            this.displayService.firingSequencesPetriNetPreview.set(diagram);

            // Source of Truth für gefeuerten Transitionen auf das gültige Präfix der Eingabe setzen
            const validTransitions = this.currentValidationResult.filter(r => r.valid).map(r => r.transition);
            this.validationService.firedTransitions.set(validTransitions);
        }

        this.isCurrentSequenceValid = this.currentValidationResult.length > 0 && this.currentValidationResult.every(r => r.valid);
    }

    private sanitizeSequenceInput(value: string): string {
        return value
            .replace(/[,_;.-]+/g, ' ') // häufige Trennzeichen durch Leerzeichen ersetzen
            .replace(/[^a-zA-Z0-9 ]+/g, ' ') // nur Buchstaben, Zahlen und Leerzeichen
            .replace(/\s+/g, ' '); // keine mehrfachen Leerzeichen
    }

    getValidationBorderCssClass(validationResult: {valid: boolean}[] | null | undefined): string {
        if (!validationResult || validationResult.length === 0) {
            return '';
        }

        const allValid = validationResult.every(r => r.valid);
        if (allValid) {
            return 'valid-input';
        }

        const someValid = validationResult.some(r => r.valid);
        if (someValid) {
            return 'partly-valid-input';
        }

        return 'invalid-input';
    }

    getValidationTextColorCssClass(valid: boolean): string {
        return valid ? 'color-valid' : 'color-invalid';
    }


    private performGlobalValidation(resultsMap: Map<ValidationTargetId, ValidationResult>): void {
        if (this.sequences.length === 0) {
            // Prüfen, ob es überhaupt maximale Sequenzen gibt
            const {maximalSequencesExist} = this.checkMaximalSequencesMatch();
            if (!maximalSequencesExist) {
                // Keine maximalen Sequenzen vorhanden -> Benutzer hat korrekt keine Sequenzen eingegeben
                resultsMap.set('Firing Sequences', {status: 'success', message: 'No maximal firing sequences exist for this Petri net.'});
            } else {
                resultsMap.set('Firing Sequences', {status: 'info', message: 'No sequences provided'});
            }
            return;
        }

        // Alle fertigen Sequenzen gegen das AKTUELLE Petri-Netz (im initialen Zustand) validieren
        const diagram = this.displayService.diagram().clone();
        let allValid = true;
        let invalidCount = 0;

        for (let i = 0; i < this.sequences.length; i++) {
            const sequence = this.sequences.at(i).value;
            // Für jede Sequenzvalidierung eine neue Kopie verwenden, da validateTransitionSequenceDetailed Transitionen auf dem übergebenen Diagramm feuert
            const validationDiagram = diagram.clone();
            const result = this.validationService.validateTransitionSequenceDetailed(validationDiagram, sequence);

            // auch die gespeicherten Validierungsergebnisse aktualisieren (zwar optional, aber für Konsistenz)
            this.validationResults[i] = result;

            if (result.some(r => !r.valid)) {
                allValid = false;
                invalidCount++;
            }
        }

        if (!allValid) {
            resultsMap.set('Firing Sequences', {status: 'error', message: `${invalidCount} sequence${invalidCount > 1 ? 's are' : ' is'} invalid`});
        } else if (this.infinityHint()) {
            resultsMap.set('Firing Sequences', {
                status: 'warning',
                message: 'The Petri net is unbounded or has cycles, so infinitely many firing sequences exist. Complete enumeration is impossible.'
            });
        } else if (this.maxNumberOfSequences()) {
            resultsMap.set('Firing Sequences', {
                status: 'warning',
                message: 'Number of all valid firing sequences is finite, but too large to display. No complete generation provided.'
            });
        } else {
            const {allFound} = this.checkMaximalSequencesMatch();

            if (allFound) {
                resultsMap.set('Firing Sequences', {status: 'success', message: 'All maximal firing sequences were found and all sequences are valid.'});
            } else {
                resultsMap.set('Firing Sequences', {status: 'error', message: 'Sequences are valid, but not all maximal firing sequences have been found.'});
            }
        }
    }

    resetWorkingPetrinet() {
        this.displayService.firingSequencesPetriNetPreview.set(this.displayService.diagram().clone());
        this.validationService.resetFiredTransitions();
    }

    resetSequences(): void {
        this.sequences.clear();
        this.validationService.clearSequences();
        this.validationResults = [];
        this.currentSequence.setValue('');
        this.currentValidationResult = [];
        this.isCurrentSequenceValid = false;
        this.maxNumberOfSequences.set(false);
        this.resetWorkingPetrinet();
        this.checkInfinity();
        this.globalValidationService.clearValidationResult('Firing Sequences');
    }

    private checkInfinity(): void {
        const diagram = this.displayService.diagram();

        const reachabilityGraph = this.reachabilityGenerator.generateReachabilityGraph(diagram, {coverability: true});

        const hint = reachabilityGraph.getInfinityHint('sequences');
        this.infinityHint.set(hint);

        if (!hint) {
            this.checkForCompletion(reachabilityGraph);
        }
    }

    private checkMaximalSequencesMatch(reachabilityGraph?: ReachabilityGraph): {allFound: boolean, maximalSequencesExist: boolean} {
        if (!reachabilityGraph) {
            reachabilityGraph = this.reachabilityGenerator.generateReachabilityGraph(this.displayService.diagram(), {coverability: true});
        }

        const maximalSequences = new Set<string>();
        if (reachabilityGraph.nodes.length > 0) {
            this.collectMaximalSequences(reachabilityGraph, reachabilityGraph.nodes[0], '', maximalSequences);
        }

        const diagram = this.displayService.diagram();
        const userSequences = new Set(this.sequences.controls.map(c => this.validationService.getCanonicalSequence(diagram, c.value?.trim() || '')));

        let allFound = true;
        for (const sequence of maximalSequences) {
            if (!userSequences.has(sequence)) {
                allFound = false;
                break;
            }
        }

        return {allFound, maximalSequencesExist: maximalSequences.size > 0};
    }

    /**
     * Prüft, ob alle maximalen Transitionsfolgen vom Benutzer gefunden wurden. Dafür wird der Überdeckbarkeitsgraph heranezogen.
     * Wenn ja, wird ein Erfolg-Dialog angezeigt.
     * Falls eine Stelle mit Omega-Marke existiert oder der Erreichbarkeitsgraph Zyklen enthält, wird die Prüfung abgebrochen, da in diesem Fall unendlich viele
     * Transitionsfolgen existieren.
     */
    private checkForCompletion(reachabilityGraph?: ReachabilityGraph): void {
        if (this.infinityHint() || this.maxNumberOfSequences()) {
            return;
        }

        const {allFound, maximalSequencesExist} = this.checkMaximalSequencesMatch(reachabilityGraph);

        if (allFound && maximalSequencesExist && this.displayService.showHints()) {
            this.snackbarService.showSnackbar('Congratulations! You have found all valid firing sequences.', 'success');
            this.globalValidationService.clearValidationResult('Firing Sequences');
        }
    }

    private collectMaximalSequences(reachabilityGraph: ReachabilityGraph, currentNode: ReachabilityNode, currentPath: string, results: Set<string>): void {
        const outgoingEdges = reachabilityGraph.outgoingEdges(currentNode);

        if (outgoingEdges.length === 0) {
            if (currentPath.trim().length > 0) {
                results.add(currentPath.trim());
            }
            return;
        }

        for (const edge of outgoingEdges) {
            const label = edge.label() ?? '';
            const nextPath = currentPath.length > 0 ? currentPath + ' ' + label : label;
            this.collectMaximalSequences(reachabilityGraph, edge.target, nextPath, results);
        }
    }

    generateSequences(): void {
        const diagram = this.displayService.diagram();
        const MAX_RESULTS = 200; // max Anzahl der Sequenzen
        const MAX_DEPTH = 100; // max Länge der Sequenzen
        const maximalSequences = this.transitionSequencesValidationService.findMaximalTransitionSequences(diagram, {
            maxDepth: MAX_DEPTH,
            maxResults: MAX_RESULTS
        });
        this.maxNumberOfSequences.set(maximalSequences.length >= MAX_RESULTS);

        const truncatedByLimit = maximalSequences.length >= MAX_RESULTS;

        if (!diagram) {
            return;
        }


        if (!truncatedByLimit) {
            this.checkForCompletion();
        }

        // Wenn infinityHint gesetzt: es gibt Zyklen oder Unbeschränktheit
        // Wir generieren trotzdem "cycle-truncated" (= endliche Präfixe), aber sagen es dem User.
        if (this.infinityHint()) {
            this.snackbarService.showSnackbar(
                'Cycles/unboundedness detected. Generating finite firing sequence prefixes only.',
                'info'
            );
        }


        // Set mit den canonical-Sequenzen, die bereits existieren -> prüfe auf vorhandene Sequenz in 0(1)
        const existingCanonical = new Set<string>(
            this.sequences.controls.map(c =>
                this.validationService.getCanonicalSequence(diagram, (c.value || '').trim()))
        );

        // tatsächlich neu hinzufügte Sequenzen (keine Duplikate).
        let added = 0;

        // Iteration über die generierten Sequenzen
        for (const seq of maximalSequences) {
            const trimmed = seq.trim();

            // Leere Sequenzen ignorieren (z.B. wenn initial schon kein Transition enabled ist)
            if (!trimmed) {
                continue;
            }

            // Canonicalize, damit wir Duplikate robust erkannt werden
            const canonicalValue = this.validationService.getCanonicalSequence(diagram, trimmed);

            // Duplikat? -> sofort skip (schnell wegen Set)
            if (existingCanonical.has(canonicalValue)) {
                continue;
            }

            // Merken, dass Sequenz jetzt existiert
            existingCanonical.add(canonicalValue);
            added++;

            // Berechne Validierungsergebnis
            // clone(), weil validateTransitionSequenceDetailed das Diagramm "verbraucht" (Transitionen feuern).
            const validationResult = this.validationService.validateTransitionSequenceDetailed(diagram.clone(), trimmed);

            // Einführen in UI-Liste (FormArray) – Sequence 1 soll oben sein -> append (push)
            this.sequences.insert(
                0,
                new FormControl<string>(trimmed, {nonNullable: true})
            );
            this.validationService.addSequence(trimmed);
            this.validationResults.unshift(validationResult);
        }


        if (this.maxNumberOfSequences()) {
            this.snackbarService.showSnackbar(
                `Generation stopped after ${MAX_RESULTS} valid firing sequences. Too many results.`,
                'info'
            );
        } else if (this.infinityHint()) {
            this.snackbarService.showSnackbar('Maximal firing sequences are infinite for this Petri net. Finite prefixes were generated instead.',
                'info');
            return;
        } else {
            this.snackbarService.showSnackbar(
                `Added ${added} new sequence${added === 1 ? '' : 's'}.`
            );
        }

        // Prüfen, ob "alle gefunden" etc.
        // Das macht bei infinityHint() sowieso nichts, weil checkForCompletion dort sofort returnt.
        if (!truncatedByLimit) {
            this.checkForCompletion();
        }
    }

}
