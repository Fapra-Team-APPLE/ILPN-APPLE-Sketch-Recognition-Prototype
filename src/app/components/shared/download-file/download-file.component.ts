import {Component, EventEmitter, Output} from '@angular/core';
import {MatIcon} from '@angular/material/icon';
import {FileCardComponent} from '../file-card/file-card.component';

@Component({
    selector: 'app-download-file',
    templateUrl: './download-file.component.html',
    imports: [
        MatIcon,
        FileCardComponent
    ],
    styleUrls: ['./download-file.component.scss']
})
export class DownloadFileComponent {

    @Output() triggerDownload = new EventEmitter<void>();

    onClick(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerDownload.emit();
    }

}
