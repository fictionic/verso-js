// TODO: rename this to avoid confusion with globals.d.ts?
interface VersoGlobals {
  CLIENT_READY_DFD: PromiseWithResolvers<void> | null,
  __versoController: import('./controller').ClientController | null,
}

export const global = window as typeof window & VersoGlobals;
