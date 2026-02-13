import {inject, Injectable} from '@angular/core';
import {ReachabilityEdge} from '../../classes/reachability/reachability-edge';
import {ReachabilityGraph} from '../../classes/reachability/reachability-graph';
import {ReachabilityNode} from '../../classes/reachability/reachability-node';
import {ReachabilityService} from './reachability.service';

@Injectable({
    providedIn: 'root'
})
export class ReachabilityLayoutService {

    private static readonly BASE_X = 150;
    private static readonly COL_SPACING = 200;
    private static readonly ROW_SPACING = 120;

    private readonly reachabilityService = inject(ReachabilityService);

    setInitialPosition(node: ReachabilityNode) {
        node.setX(ReachabilityLayoutService.BASE_X);
        node.setY(ReachabilityLayoutService.ROW_SPACING + 80);
    }

    /**
     * Verteilung pro Quellknoten: Siblings erhalten vertikale Offsets.
     */
    applyLayout(graph: ReachabilityGraph) {
        if (!graph || graph.nodes.length === 0) {
            return;
        }
        const initial = this.reachabilityService.findInitialNode(graph);
        if (!initial) {
            return;
        }
        this.setInitialPosition(initial);

        // Kanten nach Quelle gruppieren
        const outgoing = this.groupEdgesBySource(graph.edges, graph.nodes);
        const positioned = new Set<string>([initial.id]);
        const visited = new Set<string>();
        const queue: ReachabilityNode[] = [initial];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current.id)) {
                continue;
            }
            visited.add(current.id);
            const edges = outgoing.get(current.id) ?? [];

            // für deterministische (konsistente) Anordnung nach Label sortieren
            const sortedOutputEdges = [...edges].sort((a, b) => (a.label() || '').localeCompare(b.label() || ''));

            sortedOutputEdges.forEach((edge, siblingIndex) => {
                const position = this.getSuccessorPosition(current, siblingIndex);
                if (!positioned.has(edge.target.id)) {
                    edge.target.setX(position.x);
                    edge.target.setY(position.y);
                    positioned.add(edge.target.id);
                }
                queue.push(edge.target);
            });
        }
    }

    private groupEdgesBySource(edges: ReachabilityEdge[], nodes: ReachabilityNode[]): Map<string, ReachabilityEdge[]> {
        const map = new Map<string, ReachabilityEdge[]>();
        for (const node of nodes) {
            map.set(node.id, []);
        }
        for (const edge of edges) {
            const edgesBySource = map.get(edge.source.id);
            if (edgesBySource) {
                edgesBySource.push(edge);
            }
        }
        return map;
    }

    private getSuccessorPosition(current: ReachabilityNode, siblingIndex: number): {x: number; y: number} {
        const baseX = current.x();
        const baseY = current.y();
        const x = baseX + ReachabilityLayoutService.COL_SPACING;
        return {x, y: baseY + siblingIndex * ReachabilityLayoutService.ROW_SPACING};
    }

}
