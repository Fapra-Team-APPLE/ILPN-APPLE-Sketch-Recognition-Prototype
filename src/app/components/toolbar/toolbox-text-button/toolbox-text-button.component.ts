import {Component, input, output} from '@angular/core';
import {MatButton} from '@angular/material/button';
import {MatIcon} from '@angular/material/icon';

@Component({
    selector: 'app-toolbox-text-button',
    imports: [
        MatButton,
        MatIcon
    ],
    templateUrl: './toolbox-text-button.component.html',
    styleUrl: './toolbox-text-button.component.scss'
})
export class ToolboxTextButtonComponent {

    label = input.required<string>();
    icon = input<string>();
    buttonClick = output();

}
