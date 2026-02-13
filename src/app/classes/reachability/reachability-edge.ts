import {requireCloneOverride} from '../class-helper';
import {DiagramEdge} from '../diagram/diagram-edge';
import {Coords} from '../json-petri-net';
import {ReachabilityNode} from './reachability-node';

export class ReachabilityEdge extends DiagramEdge<ReachabilityNode> {

    constructor(source: ReachabilityNode, target: ReachabilityNode, transition: string, waypoints: Array<Coords> = [], curveIndex: number = 0) {
        super(source, target, 1, waypoints, transition, curveIndex);
    }

    override clone(): this {
        requireCloneOverride(this, ReachabilityEdge);
        const clone = new ReachabilityEdge(this.source, this.target, this.label() ?? '', [...this.waypoints()], this.curveIndex());
        clone.setValidity(this.validity());
        return clone as this;
    }

}
