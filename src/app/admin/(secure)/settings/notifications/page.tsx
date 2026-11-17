import type { Metadata } from "next";
import NotificationsSettingsForm from "./NotificationsSettingsForm";

export const metadata: Metadata = {
  title: "Notifikasi Order · Admin",
  robots: { index: false, follow: false },
};

/** The order notification settings (email + Telegram). */
export default function AdminNotificationsSettingsPage() {
  return <NotificationsSettingsForm />;
}
