import {ChangeDetectionStrategy, Component} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule} from '@angular/material/dialog';

@Component({
    selector: 'delete-dialogue',
    imports: [MatDialogModule, MatButtonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <h2 mat-dialog-title>Clear canvas?</h2>
        <mat-dialog-content>All elements on the canvas will be deleted. This action cannot be undone.</mat-dialog-content>
        <mat-dialog-actions align="end">
            <button matButton
                    [mat-dialog-close]="false">Cancel
            </button>
            <!-- The mat-dialog-close directive optionally accepts a value as a result for the dialog. -->
            <button matButton
                    [mat-dialog-close]="true"
                    cdkFocusInitial
                    color="warn">Delete
            </button>
        </mat-dialog-actions>
    `
})
export class DeleteDialogComponent {
}
