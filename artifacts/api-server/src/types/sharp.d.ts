declare module "sharp" {
  function sharp(input?: Buffer | ArrayBuffer | Uint8Array | string | sharp.InputOptions, options?: sharp.InputOptions): sharp.Sharp;
  namespace sharp {
    interface RGBA { r: number; g: number; b: number; alpha: number }
    interface InputOptions {
      raw?: { width: number; height: number; channels: 1 | 2 | 3 | 4 };
      animated?: boolean;
      pageHeight?: number;
      page?: number;
      create?: { width: number; height: number; channels: 1 | 2 | 3 | 4; background: RGBA };
    }
    interface RawInfo { width: number; height: number; channels: number; size: number }
    interface GifOptions {
      delay?: number | number[];
      loop?: number;
      colours?: number;
      dither?: number;
    }
    interface ResizeOptions {
      withoutEnlargement?: boolean;
      fit?: "cover" | "contain" | "fill" | "inside" | "outside";
      position?: string | number;
      background?: RGBA;
    }
    interface WebpOptions {
      quality?: number;
      lossless?: boolean;
    }
    interface Sharp {
       extract(region: { left: number; top: number; width: number; height: number }): Sharp;
      resize(width: number | null, height?: number | null, options?: ResizeOptions): Sharp;
      resize(options: { width?: number; height?: number } & ResizeOptions): Sharp;
      webp(options?: WebpOptions): Sharp;
      png(options?: { quality?: number; compressionLevel?: number }): Sharp;
      gif(options?: GifOptions): Sharp;
      ensureAlpha(alpha?: number): Sharp;
      raw(): Sharp;
      metadata(): Promise<{ width?: number; height?: number; pages?: number; pageHeight?: number; delay?: number[] }>;
      toBuffer(): Promise<Buffer>;
      toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: RawInfo }>;
    }
  }
  export default sharp;
}
