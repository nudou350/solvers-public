import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProfileScreen } from "@/components/account/Profile";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.meta");
  return { title: t("profile"), robots: { index: false } };
}

export default function ProfilePage() {
  return <ProfileScreen />;
}
