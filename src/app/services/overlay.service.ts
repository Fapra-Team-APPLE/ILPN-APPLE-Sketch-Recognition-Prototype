import {ConnectedPosition, Overlay, OverlayRef} from '@angular/cdk/overlay';
import {ComponentPortal} from '@angular/cdk/portal';
import {Injectable, Injector} from '@angular/core';
import {IDiagramEdge, IDiagramNode} from '../classes/diagram/diagram-types';
import {OverlayComponent} from '../components/overlay/overlay.component';

export interface HintOverlayPayload {
    x: number;
    y: number;
    node?: IDiagramNode;
    edge?: IDiagramEdge;
}

@Injectable({providedIn: 'root'})
export class OverlayService {

    /**
     * OverlayRef ist die "Handle"-Instanz, die das CDK zurückgibt.
     * Darüber kann man detach/dispose/positionieren.
     */
    private overlayRef: OverlayRef | null = null;


    /**
     * Positions des Overlays relativ zur Origin (hier Cursor-Position)
     * Erste: Standard - falls sie nicht in Viewport passt, zwei Fallbacks
     */
    private readonly positions: ConnectedPosition[] = [
        // Standard: unter Cursor-Koordinaten
        {originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8},
        // fallback: über Cursor-Koordinaten
        {originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8},
        // fallback: rechts/unter Cursor-Koordinaten
        {originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8}
    ];

    constructor(
        private readonly overlay: Overlay,
        private readonly injector: Injector
    ) {
    }

    /**
     * Öffnet Overlay bei Mausposition und zeigt Validity von node/edge.
     */
    openAtMouse(payload: HintOverlayPayload): void {
        this.close();
        // Position strategy: "flexibleConnectedTo" kann direkt ein Point {x,y}.
        // Das ist genau Option A.
        const positionStrategy = this.overlay
            .position()
            .flexibleConnectedTo({x: payload.x, y: payload.y})
            .withPositions(this.positions)
            // "push": wenn es aus dem Viewport laufen würde, schiebt CDK es rein
            .withPush(true);

        // Overlay erzeugen
        this.overlayRef = this.overlay.create({
            positionStrategy,
            hasBackdrop: true,
            // transparent backdrop -> User kann noch sehen, was drunter ist
            // Klick außerhalb schließt
            backdropClass: 'cdk-overlay-transparent-backdrop',
            scrollStrategy: this.overlay.scrollStrategies.close()
        });
        // UI (OverlayComponent) als Portal in das Overlay "einmounten"
        const portal = new ComponentPortal(OverlayComponent, null, this.injector);
        const componentRef = this.overlayRef.attach(portal);

        // Inputs setzen (damit OverlayComponent Status anzeigen kann)
        componentRef.instance.node = payload.node ?? null;
        componentRef.instance.edge = payload.edge ?? null;

        // --- Close subscriptions ---
        // schließen: außerhalb des Backdrops klicken
        const subBackdrop = this.overlayRef.backdropClick().subscribe(() => this.close());
        // ESC schließt Overlay
        const subEsc = this.overlayRef?.keydownEvents().subscribe((event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.close();
            }
        });

        // Cleanup: wenn Overlay detach/ dispose passiert, unsubscribe
        this.overlayRef.detachments().subscribe(() => {
            subBackdrop.unsubscribe();
            subEsc?.unsubscribe();
        });
    }

    close(): void {
        this.overlayRef?.dispose();
        this.overlayRef = null;
    }

}
