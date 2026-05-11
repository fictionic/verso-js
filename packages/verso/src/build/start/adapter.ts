import type {BundleResult} from "../bundle";
import type {ServerEntry} from "../entrypoint";

export interface RuntimeAdapter {
  loadAssets(): Promise<BundleResult>;
  loadServerEntry(): Promise<ServerEntry>;
  serve(handler: (req: Request) => Promise<Response>, opts: ServeOptions): Promise<ServerHandle>;
}

export type ServeOptions = {
  port?: number;
  host?: string;
  signal?: AbortSignal;
};

export type ServerHandle = {
  url: string;
  close(): Promise<void>;
};
