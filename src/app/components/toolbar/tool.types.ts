// ToolType:  alle Werkzeuge, die in Toolbox ausgewählt werden können
// -> orientiert an den existierenden DiagramNode-Kindern (
// -> "arrow" existiert nun als Button, aber ohne Zeichenfunktion
export type ToolType = 'clear' | 'place' | 'transition' | 'arc' | 'eraser' | 'layout' | 'lightbulb';

export interface ButtonConfig {
    tooltip?: string;
    icon?: string; // Material-Icon-Name
    svgIcon?: string; // Name eines via MatIconRegistry registrierten SVGs
}

export const BUTTON_LIBRARY: ReadonlyMap<ToolType, ButtonConfig> = new Map<ToolType, ButtonConfig>
([
    ['clear', {tooltip: 'Clear', icon: 'delete'}],
    ['place', {tooltip: 'Place', icon: 'radio_button_unchecked'}],
    ['transition', {tooltip: 'Transition', icon: 'crop_square'}],
    ['arc', {tooltip: 'Arc', icon: 'arrow_forward'}],
    ['eraser', {tooltip: 'Eraser', svgIcon: 'eraser'}],
    ['layout', {tooltip: 'Auto Layout', icon: 'auto_fix_high'}],
    ['lightbulb', {tooltip: 'Get Hint', svgIcon: 'lightbulb'}]
]);
