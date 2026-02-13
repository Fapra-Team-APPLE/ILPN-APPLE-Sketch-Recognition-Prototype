import {Component, input, output} from '@angular/core';
import {MatIconButton} from '@angular/material/button';
import {MatIcon} from '@angular/material/icon';
import {MatTooltip} from '@angular/material/tooltip';

@Component({
    selector: 'app-download-button',
    imports: [
        MatIconButton,
        MatIcon,
        MatTooltip
    ],
    templateUrl: './download-button.component.html',
    styleUrl: './download-button.component.scss'
})
export class DownloadButtonComponent {

    tooltipText = input('Download diagram');
    buttonClick = output<MouseEvent>();

}
