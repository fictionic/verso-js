import { defineMiddleware } from '@verso-js/verso';

export default defineMiddleware('all', (fns) => ({
  getRouteDirective: (next) => {
    console.log("authenticating...");
    return next();
  },
}));
