import {ChangeDetectionStrategy, Component} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule} from '@angular/material/dialog';

@Component({
    selector: 'clear-sequences-dialog',
    imports: [MatDialogModule, MatButtonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <h2 mat-dialog-title>Clear sequences?</h2>
        <mat-dialog-content>All entered firing sequences will be deleted. This action cannot be undone.</mat-dialog-content>
        <mat-dialog-actions align="end">
            <button matButton
                    [mat-dialog-close]="false">Cancel
            </button>
            <button matButton
                    [mat-dialog-close]="true"
                    cdkFocusInitial
                    color="warn">Delete
            </button>
        </mat-dialog-actions>
    `
})
export class ClearSequencesDialogComponent {
}
