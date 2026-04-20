import { defineConfig } from '@verso-js/verso';

export default defineConfig({
  server: {
    urlPrefix: 'http://localhost:3000',
  },
  middleware: ['./src/PageHeader'],
  routes: {
    // pages
    DemoPage: {
      path: '/',
      handler: './src/DemoPage',
    },
    LinkPage: {
      path: '/link',
      handler: './src/LinkPage',
    },
    // endpoints
    UsersEndpoint: {
      path: '/api/users/:id',
      handler: './src/endpoints/UsersEndpoint',
    },
    ThemeEndpoint: {
      path: '/api/theme/:userId',
      handler: './src/endpoints/ThemeEndpoint',
    },
    ActivityEndpoint: {
      path: '/api/activity',
      handler: './src/endpoints/ActivityEndpoint',
    },
  },
});
