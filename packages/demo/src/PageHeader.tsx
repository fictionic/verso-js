import { Root, defineMiddleware } from '@verso-js/verso';

interface HeaderConfig {
  showHeader: boolean;
};

export default defineMiddleware('page', () => {
  return {
    addConfigValues() {
      return {
        showHeader: true,
      };
    },

    getRouteDirective(next) {
      return next();
    },

    getElements(next) {
      return [
        <Root>
          <header>
            my cool header
          </header>
        </Root>,
        ...next(),
      ];
    }
  };
});
