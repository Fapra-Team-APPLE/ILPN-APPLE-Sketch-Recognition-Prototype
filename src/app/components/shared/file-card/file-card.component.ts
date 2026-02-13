import {Component, input} from '@angular/core';

@Component({
    selector: 'app-file-card',
    templateUrl: './file-card.component.html',
    styleUrls: ['./file-card.component.scss']
})
export class FileCardComponent {

    draggable = input<boolean>(false);
    textSelectionDisabled = input<boolean>(true);

    readonly title = input<string>();
    readonly description = input<string>();

}
