import {Injectable} from '@angular/core';
import party from 'party-js';

@Injectable({
    providedIn: 'root'
})
export class GreatSuccessService {

    private debounceTimer: unknown;

    showGreatSuccess(): void {
        if (this.debounceTimer) {
            return;
        }

        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
        }, 2500);

        this.showConfetti();
        this.showGreatSuccessGif();
    }

    private showConfetti() {
        party.confetti(new party.Rect(window.innerWidth / 2, window.innerHeight / 2 - 0.2 * window.innerHeight), {
            count: party.variation.range(100, 200),
            spread: party.variation.range(200, 500),
            size: party.variation.range(1.4, 1.7),
            shapes: ['star', 'circle']
        });
    }

    private showGreatSuccessGif() {
        const img = document.createElement('img');
        img.src = 'assets/great-success-borat.gif';
        img.style.position = 'fixed';
        img.style.left = '50%';
        img.style.top = '50%';
        img.style.transform = 'translate(-50%, -50%)';
        img.style.zIndex = '10000';
        img.style.pointerEvents = 'none';
        document.body.appendChild(img);

        setTimeout(() => {
            img.remove();
        }, 2500);
    }

}
