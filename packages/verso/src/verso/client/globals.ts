interface VersoGlobals {
  CLIENT_READY_DFD: PromiseWithResolvers<void> | null,
}

export const global = window as typeof window & VersoGlobals;
