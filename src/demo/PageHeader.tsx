import {Root} from "@/sluice/core/components/Root";
import {defineMiddleware} from "@/sluice/Middleware";

interface HeaderConfig {
  showHeader: boolean;
};

export default defineMiddleware<'page', HeaderConfig>('page', () => {
  return {
    addConfigValues() {
      return {
        showHeader: true,
      };
    },

    handleRoute(next) {
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
