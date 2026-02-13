import {Signal, signal, WritableSignal} from '@angular/core';
import {requireCloneOverride} from '../class-helper';
import {Coords} from '../json-petri-net';
import {DiagramValidity, IDiagramEdge, IDiagramNode} from './diagram-types';

export class DiagramEdge<NodeType extends IDiagramNode = IDiagramNode> implements IDiagramEdge<NodeType> {

    private readonly _source: NodeType;
    private readonly _target: NodeType;
    private readonly _weight: WritableSignal<number>;
    public readonly weight: Signal<number>;
    public readonly waypoints: WritableSignal<Array<Coords>>;
    private readonly _label: WritableSignal<string | undefined>;
    public readonly label: Signal<string | undefined>;

    private readonly _curveIndex: WritableSignal<number>;
    public readonly curveIndex: Signal<number>;

    private readonly _validity = signal<DiagramValidity>(undefined);
    readonly validity = this._validity.asReadonly();

    // eslint-disable-next-line max-params
    constructor(source: NodeType, target: NodeType, weight: number = 1, waypoints: Array<Coords> = [], label?: string, curveIndex: number = 0) {
        this._source = source;
        this._target = target;
        this._weight = signal(weight);
        this.weight = this._weight.asReadonly();
        this.waypoints = signal(waypoints);
        this._label = signal(label);
        this.label = this._label.asReadonly();
        this._curveIndex = signal(curveIndex);
        this.curveIndex = this._curveIndex.asReadonly();
    }

    get source(): NodeType {
        return this._source;
    }

    get target(): NodeType {
        return this._target;
    }

    incrementWeight(): void {
        this._weight.update(w => w + 1);
    }

    decrementWeight(min: number = 1): void {
        this._weight.update(w => w > min ? w - 1 : w);
    }

    setLabel(value: string | undefined) {
        this._label.set(value);
    }

    setValidity(status: DiagramValidity) {
        this._validity.set(status);
    }

    setCurveIndex(value: number) {
        this._curveIndex.set(value);
    }

    clone(): this {
        requireCloneOverride(this, DiagramEdge);
        const clone = new DiagramEdge(this.source, this.target, this.weight(), [...this.waypoints()], this.label(), this.curveIndex());
        clone.setValidity(this.validity());
        return clone as this;
    }

}
