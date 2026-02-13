import {Signal} from '@angular/core';
import {Coords} from '../json-petri-net';
import {Diagram} from './diagram';
import {DiagramEdge} from './diagram-edge';
import {DiagramNode} from './diagram-node';

export type DiagramNodeKind = 'place' | 'transition' | 'state';
export type DiagramValidity = {
    status: 'valid'
} | {
    status: 'invalid',
    reasons: string[]
} | {
    status: 'partly-valid',
    reasons: string[]
} | undefined;

export interface DiagramHint {
    message?: string;
}

export interface IDiagramNode {
    readonly id: string;
    readonly kind: DiagramNodeKind;
    readonly label: Signal<string | undefined>;
    readonly effectiveLabel: Signal<string>;
    readonly x: Signal<number>;
    readonly y: Signal<number>;
    readonly validity: Signal<DiagramValidity>;
    readonly activated: Signal<boolean>;
    setX(value: number): void;
    setY(value: number): void;
    setValidity(status: DiagramValidity): void;
    clone(): this;
}

export interface IDiagramEdge<NodeType extends IDiagramNode = IDiagramNode> {
    readonly source: NodeType;
    readonly target: NodeType;
    readonly waypoints: Signal<Array<Coords>>;
    readonly weight: Signal<number>;
    readonly label: Signal<string | undefined>;
    readonly curveIndex: Signal<number>;
    readonly validity: Signal<DiagramValidity>;
    setValidity(validity: DiagramValidity): void;
    clone(): this;
}


export type PetriNet = Diagram<DiagramNode, DiagramEdge<DiagramNode>>;
export type ProcessNet = Diagram<DiagramNode, DiagramEdge<DiagramNode>>;
