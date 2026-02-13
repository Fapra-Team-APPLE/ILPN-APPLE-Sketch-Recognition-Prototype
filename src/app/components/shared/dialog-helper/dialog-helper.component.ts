import {Component, inject} from '@angular/core';
import {MatButton} from '@angular/material/button';
import {MAT_DIALOG_DATA, MatDialogModule} from '@angular/material/dialog';
import {MatExpansionModule} from '@angular/material/expansion';
import {MatIconModule} from '@angular/material/icon';

export interface DialogData {
    title: string;
    message: string;
    hint?: string;
    isError?: boolean;
}

@Component({
    selector: 'app-dialog-helper',
    imports: [
        MatDialogModule,
        MatButton,
        MatExpansionModule,
        MatIconModule
    ],
    templateUrl: './dialog-helper.component.html',
    styleUrl: './dialog-helper.component.scss'
})

export class DialogHelperComponent {

    readonly data: DialogData = inject(MAT_DIALOG_DATA);

}
