// Minimal ambient types for color-thief-node (ships no bundled .d.ts).
// getColorFromURL → dominant [r,g,b]; getPaletteFromURL → array of [r,g,b].
declare module "color-thief-node" {
  export function getColorFromURL(url: string): Promise<[number, number, number]>;
  export function getPaletteFromURL(url: string, colorCount?: number, quality?: number): Promise<[number, number, number][]>;
}
