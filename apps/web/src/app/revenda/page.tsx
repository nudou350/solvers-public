import type { Metadata } from "next";
import { ResaleSoon } from "@/components/creator/ResaleSoon";

export const metadata: Metadata = {
  title: "Mercado de revenda (em breve)",
  description: "Em breve: revenda a licença do especialista que você não usa mais. O criador ganha royalty em cada revenda feita no Solvers.",
};

export default function ResalePage() {
  return <ResaleSoon />;
}
