import type { VersoConfig } from '@verso-js/verso/config';

const demoConfig: VersoConfig = {
  routes: './src/routes.ts',
  server: {
    urlPrefix: 'http://localhost:3000',
  },
};

export default demoConfig;
