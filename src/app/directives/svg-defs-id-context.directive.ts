import {Directive} from '@angular/core';

@Directive({
    selector: '[appSvgDefsIdContext]',
    exportAs: 'svgDefsIdContext'
})
export class SvgDefsIdContextDirective {

    static nextIdSuffix = 0;
    readonly idSuffix: number = SvgDefsIdContextDirective.nextIdSuffix++;

}
