import {Component, Input} from '@angular/core';
import {DiagramValidity, IDiagramEdge, IDiagramNode} from '../../classes/diagram/diagram-types';

type ValidityStatus = 'valid' | 'invalid' | 'partly-valid';

@Component({
    selector: 'overlay',
    templateUrl: './overlay.component.html',
    styleUrls: ['./overlay.component.scss']
})
export class OverlayComponent {

    @Input() node: IDiagramNode | null = null;
    @Input() edge: IDiagramEdge | null = null;

    get validity(): DiagramValidity {
        if (this.node) {
            return this.node.validity();
        }
        if (this.edge) {
            return this.edge.validity();
        }
        return undefined;
    }

    /**
     * validity().status existiert immer, wenn validity nicht undefined ist
     */

    get validityStatus(): ValidityStatus | null {
        const v = this.validity;
        return v ? v.status : null;
    }

    get validityReasons(): string[] {
        const v = this.validity;
        if (!v) {
            return [];
        }
        if (v.status === 'valid') {
            return [];
        }
        return v.reasons;
    }

    get hasReasons(): boolean {
        return this.validityReasons.length > 0;
    }

    get elementTitle(): string {
        if (this.node) {
            if (this.node.kind === 'state') {
                return 'Hint for ' + this.node.id;
            }
            return 'Hint for ' + (this.node.effectiveLabel() ?? 'unlabeled Node');
        }

        if (this.edge) {
            return 'Hint for ' + (this.edge.label() ?? 'unlabeled Edge');
        }
        return 'Hint';
    }

}
