import type {SluiceRoutes} from "@/sluice/server/router";

export default {
  DemoPage: {
    path: '/',
    page: './DemoPage',
  },
  LinkPage: {
    path: '/link',
    page: './LinkPage',
  },
} satisfies SluiceRoutes;
