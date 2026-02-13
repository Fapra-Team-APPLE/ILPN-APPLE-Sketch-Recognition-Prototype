import {Component, inject} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {ExportFormat} from '../../../services/export.service';

export type SaveAsDialogResult = ExportFormat | undefined;

@Component({
    selector: 'app-save-as-dialog',
    template: `
        <h2 mat-dialog-title>Download</h2>
        <div mat-dialog-content>
            <p>Please pick a download format:</p>
        </div>
        <div mat-dialog-actions style="display:flex; gap:8px; justify-content:flex-end">
            <button mat-button (click)="close('json')">
                <mat-icon>data_object</mat-icon>
                JSON
            </button>
            <button mat-button (click)="close('pnml')">
                <mat-icon>description</mat-icon>
                PNML
            </button>
            <button mat-button color="warn" (click)="close(undefined)">Abbrechen</button>
        </div>
    `,
    imports: [MatButtonModule, MatIconModule, MatDialogTitle, MatDialogContent, MatDialogActions]
})
export class SaveAsDialogComponent {

    private readonly dialogRef = inject<MatDialogRef<SaveAsDialogComponent, SaveAsDialogResult>>(MatDialogRef);

    close(format: SaveAsDialogResult) {
        this.dialogRef.close(format);
    }

}
