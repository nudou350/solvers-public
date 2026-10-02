import type { Metadata } from "next";
import { PublishFlow } from "@/components/creator/PublishFlow";

export const metadata: Metadata = { title: "Publicar especialista" };

export default function PublishPage() {
  return <PublishFlow />;
}
