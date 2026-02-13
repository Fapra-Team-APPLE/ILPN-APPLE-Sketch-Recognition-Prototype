import {inject, Injectable} from '@angular/core';
import {MatDialog, MatDialogRef} from '@angular/material/dialog';
import {saveAs} from 'file-saver';
import {Diagram} from '../classes/diagram/diagram';
import {DiagramEdge} from '../classes/diagram/diagram-edge';
import {DiagramNode} from '../classes/diagram/diagram-node';
import {IDiagramNode} from '../classes/diagram/diagram-types';
import {Coords, JsonPetriNet} from '../classes/json-petri-net';
import {SaveAsDialogComponent, SaveAsDialogResult} from '../components/toolbar/save-as-dialog/save-as-dialog.component';
import {SnackbarService} from './snackbar.service';

export type ExportFormat = 'json' | 'pnml';

@Injectable({
    providedIn: 'root'
})
export class ExportService {

    private readonly snackbar = inject(SnackbarService);
    private readonly dialog = inject(MatDialog);

    openExportDialog(diagram: Diagram | null | undefined) {
        if (!diagram || diagram.nodes.length === 0) {
            this.snackbar.showSnackbar('No net exists for export.', 'error');
            return;
        }
        const ref: MatDialogRef<SaveAsDialogComponent, SaveAsDialogResult> = this.dialog.open(SaveAsDialogComponent, {width: '320px', autoFocus: 'dialog'});
        ref.afterClosed().subscribe(format => {
            if (format === 'json' || format === 'pnml') {
                this.export(diagram, format);
            }
        });
    }

    export(diagram: Diagram | null | undefined, format: ExportFormat) {
        if (!diagram || diagram.nodes.length === 0) {
            this.snackbar.showSnackbar('No net exists for export.', 'error');
            return;
        }

        try {
            if (format === 'json') {
                const json = this.toJson(diagram);
                const data = JSON.stringify(json, null, 2);
                this.downloadBlob(this.createFilename('json'), 'application/json', data);
            } else {
                const xml = this.toPnml(diagram);
                this.downloadBlob(this.createFilename('pnml'), 'application/xml', xml);
            }
        } catch (e) {
            console.error('Export Error', e);
            this.snackbar.showSnackbar('Export failed.', 'error');
        }
    }

    private createFilename(ext: 'json' | 'pnml'): string {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        const dd = now.getDate().toString().padStart(2, '0');
        const hh = now.getHours().toString().padStart(2, '0');
        const min = now.getMinutes().toString().padStart(2, '0');
        const stamp = `${yyyy}-${mm}-${dd}_${hh}-${min}`;
        return `petri-net_${stamp}.${ext}`;
    }

    private toJson(diagram: Diagram): JsonPetriNet {
        const places: string[] = [];
        const transitions: string[] = [];
        const layout: Record<string, Coords | Array<Coords>> = {};
        const labels: Record<string, string> = {};
        const marking: Record<string, number> = {};
        const actionsSet = new Set<string>();

        for (const node of diagram.nodes) {
            layout[node.id] = {x: node.x(), y: node.y()};

            if (node.kind === 'place') {
                places.push(node.id);
                if (node instanceof DiagramNode && node.tokenCount > 0) {
                    marking[node.id] = node.tokenCount;
                }
                const label = node.label();
                if (label) {
                    labels[node.id] = label;
                }
            } else if (node.kind === 'transition') {
                transitions.push(node.id);
                const label = node.label();
                if (label) {
                    labels[node.id] = label;
                    actionsSet.add(label);
                }
            }
        }

        const arcs: Record<string, number> = {};
        for (const edge of diagram.edges) {
            const key = `${edge.source.id},${edge.target.id}`;
            arcs[key] = edge.weight();
            if (edge.waypoints()?.length) {
                layout[key] = edge.waypoints();
            }
        }

        return {
            places,
            transitions,
            arcs,
            labels,
            actions: Array.from(actionsSet).sort(),
            marking,
            layout
        };
    }

    private toPnml(diagram: Diagram): string {
        const placesXml = diagram.nodes
            .filter(n => n.kind === 'place')
            .map(n => this.placeToPnml(n as DiagramNode))
            .join('\n');

        const transitionsXml = diagram.nodes
            .filter(n => n.kind === 'transition')
            .map(n => this.transitionToPnml(n))
            .join('\n');

        const arcsXml = diagram.edges
            .map(e => this.arcToPnml(e))
            .join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>
<!--Created with APPLE, the Advanced Platform for Petri net Learning Evaluation
Manual editing may break compatibility.-->
<pnml xmlns="http://www.pnml.org/version-2009/grammar/pnml">
  <net type="http://www.pnml.org/version-2009/grammar/pnmlcoremodel" id="net1">
    <page id="page1">
${placesXml}
${transitionsXml}
${arcsXml}
    </page>
  </net>
</pnml>
`;
    }

    private placeToPnml(n: DiagramNode): string {
        const id = this.escapeXml(n.id);
        const graphics = this.positionPnml(n.x(), n.y());
        const name = this.namePnml(n.effectiveLabel());
        const marking = n.tokenCount > 0
            ? `\n        <initialMarking>\n          <text>${n.tokenCount}</text>\n        </initialMarking>`
            : '';

        return `      <place id="${id}">\n${graphics}${name}${marking}\n      </place>`;
    }

    private transitionToPnml(n: IDiagramNode): string {
        const id = this.escapeXml(n.id);
        const graphics = this.positionPnml(n.x(), n.y());
        const name = this.namePnml(n.effectiveLabel());

        return `      <transition id="${id}">\n${graphics}${name}\n      </transition>`;
    }

    private arcToPnml(e: DiagramEdge): string {
        const source = this.escapeXml(e.source.id);
        const target = this.escapeXml(e.target.id);
        const id = this.escapeXml(`${e.source.id}__${e.target.id}`);

        let graphics = '';
        if (e.waypoints() && e.waypoints().length > 0) {
            const points = e.waypoints().map(w => `          <position x="${w.x}" y="${w.y}"/>`).join('\n');
            graphics = `\n        <graphics>\n${points}\n        </graphics>`;
        }

        const inscription = e.weight() !== undefined
            ? `\n        <inscription>\n          <text>${e.weight()}</text>\n        </inscription>`
            : '';

        return `      <arc id="${id}" source="${source}" target="${target}">${graphics}${inscription}\n      </arc>`;
    }

    private escapeXml(s: string): string {
        return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    private positionPnml(x: number, y: number): string {
        return `        <graphics>\n          <position x="${x}" y="${y}"/>\n        </graphics>`;
    }

    private namePnml(label: string | undefined): string {
        if (!label) {
            return '';
        }
        return `\n        <name>\n          <text>${this.escapeXml(label)}</text>\n        </name>`;
    }

    private downloadBlob(filename: string, mime: string, data: string) {
        const blob = new Blob([data], {type: mime});
        saveAs(blob, filename);
    }

}
