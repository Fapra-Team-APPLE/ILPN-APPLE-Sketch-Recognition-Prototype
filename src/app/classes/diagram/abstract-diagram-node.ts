import {computed, Signal, signal} from '@angular/core';
import {DiagramNodeKind, DiagramValidity, IDiagramNode} from './diagram-types';

export abstract class AbstractDiagramNode implements IDiagramNode {

    private readonly _id: string;
    private readonly _x = signal<number>(0);
    private readonly _y = signal<number>(0);
    readonly x: Signal<number> = this._x.asReadonly();
    readonly y: Signal<number> = this._y.asReadonly();

    private readonly _label = signal<string | undefined>(undefined);
    readonly label = this._label.asReadonly();

    effectiveLabel = computed(() => this.label() || this.id);

    private readonly _validity = signal<DiagramValidity>(undefined);
    readonly validity = this._validity.asReadonly();

    private readonly _activated = signal<boolean> (false);
    readonly activated = this._activated.asReadonly();

    abstract readonly kind: DiagramNodeKind;

    protected constructor(id: string) {
        this._id = id;
    }

    get id(): string {
        return this._id;
    }

    setX(value: number) {
        this._x.set(value);
    }

    setY(value: number) {
        this._y.set(value);
    }

    setLabel(value: string | undefined) {
        this._label.set(value);
    }

    setValidity(status: DiagramValidity) {
        this._validity.set(status);
    }

    setActivated(value : boolean) {
        this._activated.set(value);
    }

    abstract clone(): this;

}
