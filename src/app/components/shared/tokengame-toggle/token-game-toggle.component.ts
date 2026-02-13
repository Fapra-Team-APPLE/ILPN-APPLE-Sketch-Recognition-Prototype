import {Component, computed, inject, input} from '@angular/core';
import {MatSlideToggle, MatSlideToggleChange} from '@angular/material/slide-toggle';
import {DisplayService} from '../../../services/display.service';

@Component({
    selector: 'app-tokengame-toggle',
    imports: [
        MatSlideToggle
    ],
    templateUrl: './token-game-toggle.component.html',
    styleUrl: './token-game-toggle.component.scss'
})
export class TokenGameToggleComponent {

    tokenGameContext = input.required<'sequences' | 'process-net' | 'reachability'>();

    displayService = inject(DisplayService);

    tokenGameEnabled = computed(() => {
        const context = this.tokenGameContext();
        if (context === 'sequences') {
            return this.displayService.firingSequencesTokenGameEnabled();
        } else if (context === 'process-net') {
            return this.displayService.processNetTokenGameEnabled();
        } else {
            return this.displayService.reachabilityTokenGameEnabled();
        }
    });

    protected onToggleTokenGame(event: MatSlideToggleChange) {
        const context = this.tokenGameContext();
        const enabled = event.checked;
        if (context === 'sequences') {
            this.displayService.firingSequencesTokenGameEnabled.set(enabled);
        } else if (context === 'process-net') {
            this.displayService.processNetTokenGameEnabled.set(enabled);
        } else {
            this.displayService.reachabilityTokenGameEnabled.set(enabled);
        }
    }

}
