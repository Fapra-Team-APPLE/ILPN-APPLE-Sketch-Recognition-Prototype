import {Component, EventEmitter, Input, Output} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {MatIconButton} from '@angular/material/button';
import {MatIcon} from '@angular/material/icon';
import {MatTooltip} from '@angular/material/tooltip';
import {BUTTON_LIBRARY, ButtonConfig, ToolType} from '../tool.types';


@Component({
    selector: 'app-toolbutton',
    templateUrl: './toolButton.component.html',
    styleUrls: ['./toolButton.component.scss'],
    imports: [FormsModule, MatIcon, MatTooltip, MatIconButton]
})
export class ToolButtonComponent {

    private _buttonType!: ToolType;
    buttonConfig! : ButtonConfig | undefined;
    @Input() activeType! : ToolType | undefined;
    @Output() selectTool: EventEmitter<string> = new EventEmitter<string>();

    @Input()
    set buttonType(value : ToolType){
        this._buttonType = value;
        this.buttonConfig = BUTTON_LIBRARY.get(value);
    }


    isButtonActive() {
        return this.activeType === this._buttonType;
    }

    onClick() {
        this.selectTool.emit();
    }

}
