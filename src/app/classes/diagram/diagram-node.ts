import {signal} from '@angular/core';
import {requireCloneOverride} from '../class-helper';
import {AbstractDiagramNode} from './abstract-diagram-node';
import {DiagramNodeKind} from './diagram-types';

export class DiagramNode extends AbstractDiagramNode {

    readonly kind: DiagramNodeKind;
    private readonly _tokenCount = signal<number>(0);

    constructor(id: string, kind: DiagramNodeKind, x?: number, y?: number) {
        super(id);
        this.kind = kind;
        if (x !== undefined) {
            this.setX(x);
        }
        if (y !== undefined) {
            this.setY(y);
        }
    }

    get tokenCount(): number {
        return this._tokenCount();
    }

    set tokenCount(value: number) {
        this._tokenCount.set(value);
    }

    /**
     * erhöht die gespeicherte Markenanzahl der Stelle
     * Analog zu DiagramEdge.incrementWeight(), nur auf _tokenCount-Signal von DiagramNode-> Änderungen landen sofort im zentralen Modell
     * & allen abhängigen Berechnungen (z.B. Reachability) können Update sehen
     */
    incrementTokenCount(): void {
        this._tokenCount.update(t => t + 1);
    }

    /**
     * verringert Markenanzahl (wenn >0), entspricht Verhalten von DiagramEdge.decrementWeight()
     * updated das _tokenCount-Signal von DiagramNode in Diagram.nodes
     */
    decrementTokenCount(min: number = 0): void {
        this._tokenCount.update(t => t > min ? t - 1 : t);
    }


    clone(): this {
        requireCloneOverride(this, DiagramNode);
        const clone = new DiagramNode(this.id, this.kind, this.x(), this.y());
        clone.setLabel(this.label());
        clone.tokenCount = this.tokenCount;
        clone.setValidity(this.validity());
        clone.setActivated(this.activated());
        return clone as this;
    }

}
