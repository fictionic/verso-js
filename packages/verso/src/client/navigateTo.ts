type GetClientController = typeof import('./controller').getClientController;

let getController: GetClientController | null = null;

if (!globalThis.IS_SERVER) {
  import('./controller').then(({ getClientController }) => {
    getController = getClientController;
  });
}

export function navigateTo(url: string) {
  if (!getController) {
    throw new Error('cannot navigate on the server!');
  }
  getController().navigate(url);
}
