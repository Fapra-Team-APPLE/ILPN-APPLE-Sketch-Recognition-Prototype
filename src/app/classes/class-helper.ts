// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function requireCloneOverride(thisObject: object, baseClass: Function): void {
    if (thisObject.constructor !== baseClass) {
        throw new Error(`Subclass ${thisObject.constructor.name} must override clone()`);
    }
}
