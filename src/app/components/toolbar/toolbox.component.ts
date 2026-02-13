import {ComponentType} from '@angular/cdk/portal';
import {Component, effect, inject, input, model, output, untracked} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatDialog} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {DisplayService} from '../../services/display.service';
import {DeleteDialogComponent} from './delete-dialog/delete-dialog.component';
import {ToolType} from './tool.types';
import {ToolbarDividerComponent} from './toolbar-divider/toolbar-divider.component';
import {ToolButtonComponent} from './toolButton/toolButton.component';


@Component({
    selector: 'app-toolbox',
    templateUrl: './toolbox.component.html',
    styleUrls: ['./toolbox.component.scss'],
    imports: [FormsModule, ToolButtonComponent, MatIconModule, ToolbarDividerComponent
    ]
})


export class ToolboxComponent {

    buttonInput = input<ToolType[]>([]);
    showEraserButton = input(true);
    showLayoutButton = input(false);
    showLightbulbButton = input(false);
    deleteDialogComponent = input<ComponentType<unknown>>(DeleteDialogComponent);
    layout = output();

    // "activeTool" speichert ausgewähltes Werkzeug.
    // Default: Kein Werkzeug ausgewählt
    readonly activeTool = model<ToolType | undefined>(undefined);

    // Output als EventEmitter mit void deklarieren, um Seiteneffekte zu verhindenr
    // signalisiert Eltern-Komponente, dass löschen-Button geklickt, onDeleteClick() ausgeführt wurde und
    // das Canvas aus der jeweiligen Komponente heraus global gelöscht werden soll
    readonly clearCanvas = output<void>();

    readonly dialog = inject(MatDialog);
    readonly displayService = inject(DisplayService);

    constructor() {
        // Reset lightbulb as active tool when its button is no longer shown
        effect(() => {
            const shouldShow = this.showLightbulbButton() && this.displayService.showHints();
            if (!shouldShow && untracked(this.activeTool) === 'lightbulb') {
                this.setTool(undefined);
            }
        });
    }

    toggleTool(tool: ToolType) {
        if (this.activeTool() === tool) {
            this.setTool(undefined);
            return;
        }
        this.setTool(tool);
    }

    private setTool(tool: ToolType | undefined) {
        this.activeTool.set(tool);
    }

    // Wird vom Delete-Button in der Toolbar aufgerufen und reicht das
    // „Canvas leeren“-Signal an die Eltern weiter. Die eigentliche
    // Aufräumlogik bleibt damit in den jeweiligen Ansichten, sodass wir
    // hier keinen Zustandsbezug haben.

    onDeleteClick() {
        const dialogRef = this.dialog.open(this.deleteDialogComponent());

        dialogRef.afterClosed().subscribe(result => {
            if (result === true) {
                this.clearCanvas.emit();
            }
        });
    }

}
