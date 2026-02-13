import {Component} from '@angular/core';

@Component({
    selector: 'app-toolbar-divider',
    imports: [],
    template: '',
    host: {
        '[style.display]': '"inline-block"',
        '[style.height]': '"40px"',
        '[style.margin]': '"auto 10px"',
        '[style.border-right]': '"2px solid grey"'
    }
})
export class ToolbarDividerComponent {

}
