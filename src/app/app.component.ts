import {Component, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule, MatIconRegistry} from '@angular/material/icon';
import {MatMenuModule} from '@angular/material/menu';
import {MatSlideToggle} from '@angular/material/slide-toggle';
import {MatTabsModule} from '@angular/material/tabs';
import {MatTooltipModule} from '@angular/material/tooltip';
import {DomSanitizer} from '@angular/platform-browser';
import {DrawingComponent} from './components/drawing/drawing.component';
import {FooterComponent} from './components/footer/footer.component';
import {ProcessNetComponent} from './components/process-net/process-net.component';
import {ReachabilityComponent} from './components/reachability/reachability.component';
import {ToolbarDividerComponent} from './components/toolbar/toolbar-divider/toolbar-divider.component';
import {TransitionSequencesComponent} from './components/transition-sequences/transition-sequences.component';
import {DisplayService} from './services/display.service';
import {SnackbarService} from './services/snackbar.service';
import {TabNavigationService} from './services/tab-navigation.service';
import {ValidationResult, ValidationService, ValidationTargetId} from './services/validation.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    imports: [
        ReactiveFormsModule,
        FooterComponent,
        MatTabsModule,
        DrawingComponent,
        ReachabilityComponent,
        TransitionSequencesComponent,
        ProcessNetComponent,
        MatSlideToggle,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatTooltipModule,
        ToolbarDividerComponent
    ]
})
export class AppComponent {

    readonly snackbarService = inject(SnackbarService);
    readonly displayService = inject(DisplayService);
    readonly validationService = inject(ValidationService);
    readonly petriNetSet = this.displayService.petriNetSet;
    readonly selectedTabIndex = inject(TabNavigationService).selectedIndex;

    readonly focusMode = signal(false);

    readonly validationResults = signal<Map<ValidationTargetId, ValidationResult | null>>(new Map());

    constructor(iconRegistry: MatIconRegistry, sanitizer: DomSanitizer) {
        iconRegistry.addSvgIcon(
            'eraser',
            sanitizer.bypassSecurityTrustResourceUrl('assets/icons/eraser.svg')
        );
        iconRegistry.addSvgIcon(
            'lightbulb',
            sanitizer.bypassSecurityTrustResourceUrl('assets/icons/lightbulb.svg')
        );

        this.validationService.clearValidationResult$.pipe(takeUntilDestroyed()).subscribe(target => {
            this.validationResults.update(map => {
                const newMap = new Map(map);
                newMap.delete(target);
                return newMap;
            });
        });
    }

    getGithubLinkForUsername(username: string): string {
        return `https://github.com/${username}`;
    }

    onToggleShowHints(value: boolean) {
        this.displayService.examMode.set(value);
        this.validationResults.set(new Map()); // reset errors
    }

    validateAll() {
        this.displayService.examMode.set(false);
        if (this.displayService.diagram().nodes.length === 0) {
            this.snackbarService.showSnackbar('Validation impossible: Petri net drawing is missing', 'info');
            return;
        }
        const resultsMap = this.validationService.requestValidation();
        this.validationResults.set(resultsMap);
        if (resultsMap.size === 0 || !Array.from(resultsMap.values()).some(value => value.status === 'success')) {
            return;
        }
        for (const value of resultsMap.values()) {
            if (value && value.status === 'error') {
                return;
            }
        }
        this.snackbarService.showSnackbar('All validations passed successfully!', 'success');
    }

    getValidationError(key: ValidationTargetId): string | undefined {
        const result = this.validationResults().get(key);
        if (!result) {
            return undefined;
        }
        if (result.status === 'error') {
            return result.hint ?? result.message;
        }
        return undefined;
    }

    getValidationSuccessMessage(key: ValidationTargetId): string | undefined {
        const result = this.validationResults().get(key);
        if (!result) {
            return undefined;
        }
        if (result.status === 'success') {
            return result.message;
        }
        return undefined;
    }

    getValidationWarningMessage(key: ValidationTargetId): string | undefined {
        const result = this.validationResults().get(key);
        if (!result) {
            return undefined;
        }
        if (result.status === 'warning') {
            return result.message;
        }
        return undefined;
    }

}
