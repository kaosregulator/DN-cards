// Minimal ambient type declarations for the `gifencoder` package.
// The package is pure JavaScript and ships without built-in types.

declare module "gifencoder" {
  export default class GIFEncoder {
    constructor(width: number, height: number);
    start(): void;
    setRepeat(repeat: number): void;
    setDelay(ms: number): void;
    setQuality(quality: number): void;
    setTransparent(color: string | number): void;
    addFrame(ctx: CanvasRenderingContext2D): void;
    finish(): void;
    out: { getData(): Buffer };
  }
}
