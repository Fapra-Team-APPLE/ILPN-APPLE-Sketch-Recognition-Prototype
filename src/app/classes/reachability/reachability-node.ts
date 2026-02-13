import {computed, signal, Signal, WritableSignal} from '@angular/core';
import {requireCloneOverride} from '../class-helper';
import {AbstractDiagramNode} from '../diagram/abstract-diagram-node';
import {DiagramNodeKind, DiagramValidity} from '../diagram/diagram-types';

export type Marking = Record<string, number | 'w'>;

export class ReachabilityNode extends AbstractDiagramNode {

    readonly kind: DiagramNodeKind = 'state';

    private readonly _marking: WritableSignal<Marking>;
    readonly marking: Signal<Marking>;

    private readonly _markingValidity = signal<Record<string, DiagramValidity>>({});
    readonly markingValidity = this._markingValidity.asReadonly();

    private readonly _userLabel = signal<string | undefined>(undefined);

    override readonly label = computed(() => {
        return this._userLabel() ?? ReachabilityNode.defaultLabelForMarking(this.marking());
    });

    private readonly _isInitialNode = signal(false);
    public readonly isInitialNode: Signal<boolean>;

    constructor(id: string, marking: Marking, x?: number, y?: number, isInitial: boolean = false) {
        super(id);
        this._marking = signal(marking);
        this.marking = this._marking.asReadonly();

        if (x !== undefined) {
            this.setX(x);
        }
        if (y !== undefined) {
            this.setY(y);
        }
        this._isInitialNode.set(isInitial);
        this.isInitialNode = this._isInitialNode.asReadonly();
    }

    override setLabel(value: string | undefined): void {
        this._userLabel.set(value);
    }

    setMarkingValidity(validity: Record<string, DiagramValidity>) {
        this._markingValidity.set(validity);
    }

    tryUpdateMarkingFromLabel(places: Array<string>): void {
        const parts = this.label().replace(/[()]/g, '').split(',').map(s => s.trim());
        const newMarking: Marking = {};

        for (let i = 0; i < parts.length; i++) {
            const tokenString = parts[i];
            let value: number | 'w' | undefined;
            if (tokenString.toLowerCase() === 'w' || tokenString === 'ω') {
                value = 'w';
            } else {
                const tokenCount = parseInt(tokenString, 10);
                if (!isNaN(tokenCount)) {
                    value = tokenCount;
                }
            }
            if (value !== undefined) {
                if (i < places.length) {
                    newMarking[places[i]] = value;
                } else {
                    newMarking[`UNKNOWN_PLACE_${i}`] = value;
                }
            }
        }
        this._marking.set(newMarking);
    }

    static defaultLabelForMarking(marking: Marking): string {
        const keys = Object.keys(marking);
        return keys.map(k => `${marking[k] ?? 0}`).join(',');
    }

    clone(): this {
        requireCloneOverride(this, ReachabilityNode);
        const clone = new ReachabilityNode(this.id, {...this.marking()}, this.x(), this.y());
        if (this._userLabel()) {
            clone.setLabel(this._userLabel());
        }
        clone.setValidity(this.validity());
        clone.setMarkingValidity({...this.markingValidity()});
        return clone as this;
    }

}
