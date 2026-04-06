type GetClientController = typeof import('./client/controller').getClientController;

let getController: GetClientController | null = null;

if (!IS_SERVER) {
  import('./client/controller').then(({ getClientController }) => {
    getController = getClientController;
  });
}

export function navigateTo(url: string) {
  if (!getController) {
    throw new Error('cannot navigate on the server!');
  }
  getController().navigate(url);
}
