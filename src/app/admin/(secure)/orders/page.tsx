import type { Metadata } from "next";
import OrdersManager from "./OrdersManager";

export const metadata: Metadata = {
  title: "Orders · Admin",
  robots: { index: false, follow: false },
};

/**
 * The Airport VIP order list.
 *
 * The page shell stays static — the rows load through the `listOrders`
 * server action from the client component, never during prerender.
 */
export default function AdminOrdersPage() {
  return <OrdersManager />;
}