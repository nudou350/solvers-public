import type { Metadata } from "next";
import { ProfileScreen } from "@/components/account/Profile";

export const metadata: Metadata = { title: "Perfil e reputação", robots: { index: false } };

export default function PerfilPage() {
  return <ProfileScreen />;
}
