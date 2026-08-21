// Minimal ambient types for @napi-rs/canvas — only the surface the battle-image
// renderer uses. Lets typecheck/build pass whether or not the package is
// installed (it is lazy-loaded + externalized, like sharp).
declare module "@napi-rs/canvas" {
  interface CanvasGradient {
    addColorStop(offset: number, color: string): void;
  }
  export interface Image {
    width: number;
    height: number;
  }
  export interface SKRSContext2D {
    fillStyle: string | CanvasGradient;
    strokeStyle: string | CanvasGradient;
    lineWidth: number;
    font: string;
    textAlign: "left" | "right" | "center" | "start" | "end";
    textBaseline: "top" | "middle" | "bottom" | "alphabetic" | "hanging" | "ideographic";
    globalAlpha: number;
    globalCompositeOperation: string;
    shadowColor: string;
    shadowBlur: number;

    save(): void;
    scale(x: number, y: number): void;
    clearRect(x: number, y: number, w: number, h: number): void;
    getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray; width: number; height: number };
    putImageData(data: { data: Uint8ClampedArray; width: number; height: number }, dx: number, dy: number): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(angle: number): void;
    beginPath(): void;
    closePath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
    arc(x: number, y: number, r: number, start: number, end: number): void;
    fill(): void;
    stroke(): void;
    clip(): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    drawImage(img: Image, x: number, y: number, w: number, h: number): void;
    drawImage(img: Image, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    fillText(text: string, x: number, y: number): void;
    strokeText(text: string, x: number, y: number): void;
    measureText(text: string): { width: number };
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient;
  }
  export interface Canvas {
    getContext(type: "2d"): SKRSContext2D;
    encode(format: "png" | "webp" | "jpeg"): Promise<Buffer>;
  }
  export function createCanvas(width: number, height: number): Canvas;
  export function loadImage(src: Buffer | Uint8Array | ArrayBuffer | string): Promise<Image>;
  export const GlobalFonts: {
    registerFromPath(path: string, name?: string): boolean;
  };
}
