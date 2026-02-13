import {Component, input} from '@angular/core';
import {FileCardComponent} from '../file-card/file-card.component';

@Component({
    selector: 'app-example-file',
    templateUrl: './example-file.component.html',
    styleUrls: ['./example-file.component.scss'],
    imports: [FileCardComponent]
})
export class ExampleFileComponent {

    public static readonly META_DATA_CODE = 'drag-file-location';

    readonly title = input<string>();
    readonly description = input<string>();
    readonly link = input.required<string>();

    prevent(e: Event) {
        e.preventDefault();
        e.stopPropagation();
    }

    hoverStart(e: MouseEvent) {
        this.prevent(e);
        const target = (e.target as HTMLElement);
        target.classList.add('mouse-hover');
    }

    hoverEnd(e: MouseEvent) {
        this.prevent(e);
        const target = (e.target as HTMLElement);
        target.classList.remove('mouse-hover');
    }

    addFileLink(e: DragEvent) {
        e.dataTransfer!.effectAllowed = 'link';
        e.dataTransfer!.setData(ExampleFileComponent.META_DATA_CODE, this.link());
    }

}
