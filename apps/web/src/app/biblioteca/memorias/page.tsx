import type { Metadata } from "next";
import { Memories } from "@/components/account/Memories";

export const metadata: Metadata = { title: "Minhas memórias", robots: { index: false } };

export default function MemoriasPage() {
  return <Memories />;
}
