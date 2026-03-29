export interface VersoConfig {
  routes: string;
  server?: {
    port?: number;
    urlPrefix?: string;
    renderTimeout?: number;
  };
}
