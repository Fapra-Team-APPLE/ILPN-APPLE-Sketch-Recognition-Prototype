import {Injectable, signal, WritableSignal} from '@angular/core';

@Injectable()
export class NodeDimensionService {

    // Eine Map, die Signale für die Breite pro Knoten-ID speichert
    private dimensions = new Map<string, WritableSignal<{w: number, h: number}>>();

    getDimension(id: string) {
        if (!this.dimensions.has(id)) {
            this.dimensions.set(id, signal({ w: 60, h: 28 }));
        }
        return this.dimensions.get(id)!;
    }

    updateDimension(id: string, w: number, h: number) {
        this.getDimension(id).set({ w, h });
    }

}
