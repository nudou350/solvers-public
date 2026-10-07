import type { Metadata } from "next";
import { Licenses } from "@/components/account/Licenses";

export const metadata: Metadata = { title: "Minha biblioteca", robots: { index: false } };

export default function BibliotecaPage() {
  return <Licenses />;
}
