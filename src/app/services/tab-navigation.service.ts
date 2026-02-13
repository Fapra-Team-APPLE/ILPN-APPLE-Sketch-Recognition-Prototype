import {Injectable, signal} from '@angular/core';

@Injectable({providedIn: 'root'})
export class TabNavigationService {

    readonly selectedIndex = signal(0);
    static readonly DRAWING_TAB_INDEX = 0;

    goToDrawingTab() {
        this.selectedIndex.set(TabNavigationService.DRAWING_TAB_INDEX);
    }

}
