import { Root, defineMiddleware } from '@verso-js/verso';

interface HeaderConfig {
  showHeader: boolean;
};

export default defineMiddleware<HeaderConfig>(() => {
  return {
    addConfigValues() {
      return {
        showHeader: true,
      };
    },

    getRouteDirective(next) {
      return next();
    },

    async getBodyClasses(next) {
      return [
        ...await next(),
        'WithHeader',
      ];
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
