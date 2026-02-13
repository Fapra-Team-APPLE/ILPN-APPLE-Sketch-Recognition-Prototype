import {inject, Injectable} from '@angular/core';
import {MatSnackBar} from '@angular/material/snack-bar';
import {GreatSuccessService} from './great-success.service';

export type SnackbarType = 'error' | 'success' | 'info';

@Injectable({
    providedIn: 'root'
})
export class SnackbarService {

    private snackBar = inject(MatSnackBar);
    private greatSuccessService = inject(GreatSuccessService);

    public showSnackbar(message: string, snackbarType: SnackbarType = 'info'): void {
        const panelClass = snackbarType === 'success' ? 'green-snackbar' : snackbarType === 'error' ? 'red-snackbar' : undefined;
        this.snackBar.open(message, 'Close', {duration: 7000, panelClass});
        if (snackbarType === 'success') {
            this.greatSuccessService.showGreatSuccess();
        }
    }

}
