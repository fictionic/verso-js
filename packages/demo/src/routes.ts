import type { SiteConfig } from '@verso-js/verso/server';
import PageHeader from './PageHeader';

export default {
  middleware: [PageHeader],
  routes: {
    DemoPage: {
      path: '/',
      handler: './DemoPage',
    },
    LinkPage: {
      path: '/link',
      handler: './LinkPage',
    },
    Users: {
      path: '/api/users/:id',
      handler: './endpoints/UsersEndpoint',
    },
    Theme: {
      path: '/api/theme/:userId',
      handler: './endpoints/ThemeEndpoint',
    },
    Activity: {
      path: '/api/activity',
      handler: './endpoints/ActivityEndpoint',
    },
  }
} satisfies SiteConfig;
