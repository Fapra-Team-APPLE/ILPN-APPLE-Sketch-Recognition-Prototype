import {Diagram} from '../diagram/diagram';
import {DiagramHint} from '../diagram/diagram-types';
import {ReachabilityEdge} from './reachability-edge';
import {ReachabilityNode} from './reachability-node';

export class ReachabilityGraph extends Diagram<ReachabilityNode, ReachabilityEdge> {

    constructor(nodes: ReachabilityNode[] = [], edges: ReachabilityEdge[] = []) {
        super(nodes, edges);
    }

    setNodeActivated(node: ReachabilityNode | null): void {
        node?.setActivated(true);
        this.nodes.forEach(n => {
            if (n !== node) {
                n.setActivated(false);
            }
        });
    }

    override getNonCoordinateHash(): string {
        const nodes = this.nodes.map(n => {
            const marking = n.marking();
            const markingString = Object.keys(marking).sort().map(key => `${key}:${marking[key]}`).join(',');

            const markingValidity = n.markingValidity();
            const markingValidityString = Object.keys(markingValidity).sort().map(key => {
                const val = markingValidity[key];
                if (!val) {
                    return '';
                }
                let reasons = '';
                if (val.status !== 'valid') {
                    reasons = val.reasons.sort().join(',');
                }
                return `${key}:${val.status}${reasons ? `(${reasons})` : ''}`;
            }).join(',');

            const validity = n.validity();
            const validityString = '';
            if (validity) {
                let reasons = '';
                if (validity.status !== 'valid') {
                    reasons = validity.reasons.sort().join(',');
                }
                validityString.concat(`overall:${validity.status}${reasons ? `(${reasons})` : ''}`);
            }


            const initialString = n.isInitialNode() ? '(initial)' : '';
            return `${n.id}|${n.label()}|{${markingString}}|{${markingValidityString}}|${validityString}|${initialString}`;
        }).sort().join(';');

        const edges = this.edges.map(edge => {
            return `${edge.source.id}|${edge.target.id}|${edge.weight()}|${edge.label()}`;
        }).sort().join(';');

        return `N:${nodes};E:${edges}`;
    }

    getInfinityHint(context: 'sequences' | 'process_net'): DiagramHint | undefined {
        const isUnbounded = this.nodes.some((n: ReachabilityNode) => Object.values(n.marking()).includes('w'));

        if (isUnbounded) {
            if (context === 'sequences') {
                return {
                    message: 'The Petri net is unbounded (contains omega markings), meaning there are infinitely many transition sequences. ' +
                        'Complete enumeration is impossible.'
                };
            } else {
                return {
                    message: 'The Petri net is unbounded (contains omega markings). Constructed Process Nets may be infinitely large.'
                };
            }
        }

        if (this.hasCycles()) {
            if (context === 'sequences') {
                return {
                    message: 'The Petri net contains cycles in the reachability graph, meaning there are infinitely many transition sequences. ' +
                        'Complete enumeration is impossible.'
                };
            } else {
                return {
                    message: 'The Petri net contains cycles in the reachability graph. Constructed Process Nets may be infinitely large.'
                };
            }
        }
        return undefined;
    }

    private hasCycles(): boolean {
        const visited = new Set<string>();

        for (const node of this.nodes) {
            const recursionStack = new Set<string>();
            if (this.detectCycle(node, visited, recursionStack)) {
                return true;
            }
        }
        return false;
    }

    private detectCycle(node: ReachabilityNode, visited: Set<string>, recursionStack: Set<string>): boolean {
        if (recursionStack.has(node.id)) {
            return true;
        }
        if (visited.has(node.id)) {
            return false;
        }

        visited.add(node.id);
        recursionStack.add(node.id);

        const outgoingEdges = this.outgoingEdges(node);
        for (const edge of outgoingEdges) {
            if (this.detectCycle(edge.target, visited, recursionStack)) {
                return true;
            }
        }

        recursionStack.delete(node.id);
        return false;
    }

}

