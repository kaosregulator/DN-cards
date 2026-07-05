declare module "sharp" {
  function sharp(input: Buffer | ArrayBuffer | Uint8Array | string): sharp.Sharp;
  namespace sharp {
    interface ResizeOptions {
      withoutEnlargement?: boolean;
      fit?: "cover" | "contain" | "fill" | "inside" | "outside";
      position?: string | number;
    }
    interface WebpOptions {
      quality?: number;
      lossless?: boolean;
    }
    interface Sharp {
      resize(width: number | null, height?: number | null, options?: ResizeOptions): Sharp;
      resize(options: { width?: number; height?: number } & ResizeOptions): Sharp;
      webp(options?: WebpOptions): Sharp;
      toBuffer(): Promise<Buffer>;
    }
  }
  export default sharp;
}
