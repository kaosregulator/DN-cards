// Minimal ambient types for the subset of canvas-sketch-util we use. The
// package ships no bundled types; we only need `math` (interpolation helpers)
// and `random` (a seedable RNG for controlled particle layouts).

declare module "canvas-sketch-util/math" {
  export function lerp(min: number, max: number, t: number): number;
  export function clamp(value: number, min: number, max: number): number;
  export function clamp01(value: number): number;
  export function mapRange(
    value: number, inputMin: number, inputMax: number,
    outputMin: number, outputMax: number, clamp?: boolean,
  ): number;
  export function smoothstep(min: number, max: number, t: number): number;
  export function degToRad(deg: number): number;
}

declare module "canvas-sketch-util/random" {
  export interface RandomInstance {
    setSeed(seed: string | number): void;
    getSeed(): string | number | undefined;
    value(): number;
    range(min: number, max: number): number;
    rangeFloor(min: number, max: number): number;
    gaussian(mean?: number, standardDerivation?: number): number;
    sign(): number;
    boolean(): boolean;
    chance(probability?: number): boolean;
    pick<T>(array: T[]): T;
    shuffle<T>(array: T[]): T[];
    onCircle(radius?: number, out?: number[]): [number, number];
    insideCircle(radius?: number, out?: number[]): [number, number];
    noise2D(x: number, y: number, frequency?: number, amplitude?: number): number;
    createRandom(defaultSeed?: string | number): RandomInstance;
  }
  const random: RandomInstance;
  export default random;
}
