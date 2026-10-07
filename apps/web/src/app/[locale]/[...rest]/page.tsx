import { notFound } from "next/navigation";

// Qualquer caminho sem página cai aqui para usar o not-found do idioma.
export default function CatchAll() {
  notFound();
}
