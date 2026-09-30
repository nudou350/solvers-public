import type { Metadata } from "next";
import { PublishWizard } from "@/components/creator/PublishWizard";

export const metadata: Metadata = { title: "Publicar especialista" };

export default function PublishPage() {
  return <PublishWizard />;
}
