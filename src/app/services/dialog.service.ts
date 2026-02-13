import {inject, Injectable} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {DialogData, DialogHelperComponent} from '../components/shared/dialog-helper/dialog-helper.component';

export type DialogType = 'error' | 'success' | 'info';

@Injectable({
    providedIn: 'root'
})
export class DialogService {

    private dialog = inject(MatDialog);

    public showDialog(message: string, hint?: string, dialogType: DialogType = 'info'): void {
        this.dialog.open<DialogHelperComponent, DialogData>(DialogHelperComponent, {
            data: {
                title: dialogType.charAt(0).toUpperCase() + dialogType.slice(1),
                message,
                hint,
                isError: dialogType === 'error'
            },
            width: '500px',
            disableClose: false
        });
    }

}
