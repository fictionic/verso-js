export interface VersoConfig {
  routes: string;
  server?: {
    port?: number;
    urlPrefix?: string;
    renderTimeout?: number;
  };
  build?: {
    outDir?: string;
    cdnPrefix?: string;
  };
}

const DEFAULT_OUT_DIR = 'dist';

export function resolveOutDir(config: VersoConfig): string {
  return config.build?.outDir ?? DEFAULT_OUT_DIR;
}
