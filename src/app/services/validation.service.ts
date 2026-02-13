import {Injectable} from '@angular/core';
import {Subject} from 'rxjs';

export type ValidationTargetId = 'Petri Net' | 'Firing Sequences' | 'Reachability Graph' | 'Process Net';

export type ValidationStatus = 'success' | 'error' | 'warning' | 'info';

export interface ValidationResult {
    status: ValidationStatus;
    message: string;
    hint?: string;
}

@Injectable({
    providedIn: 'root'
})
export class ValidationService {

    private validationRequestSubject = new Subject<Map<ValidationTargetId, ValidationResult>>();
    public readonly validationRequest$ = this.validationRequestSubject.asObservable();

    private clearValidationResultSubject = new Subject<ValidationTargetId>();
    public readonly clearValidationResult$ = this.clearValidationResultSubject.asObservable();

    public requestValidation(): Map<ValidationTargetId, ValidationResult> {
        const results = new Map<ValidationTargetId, ValidationResult>();
        this.validationRequestSubject.next(results);
        return results;
    }

    public clearValidationResult(target: ValidationTargetId): void {
        this.clearValidationResultSubject.next(target);
    }

}
