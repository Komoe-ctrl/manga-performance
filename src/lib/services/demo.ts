import { COST_POSTS, DEMO_HOTELS, DEMO_MONTHS, DEMO_PRODUCTS, demoDashboard } from "@/lib/mock/demo-dashboard";
import { latency } from "./store";

export type { CostPostId, DemoHotelMonth, DemoRecord } from "@/lib/mock/demo-dashboard";

export const getDemoDashboard = () =>
  latency(() => ({
    hotels: DEMO_HOTELS,
    products: DEMO_PRODUCTS,
    costPosts: COST_POSTS,
    months: DEMO_MONTHS,
    ...demoDashboard,
  }));
