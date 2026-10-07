import type { ReactNode } from "react";
import { LibraryShell } from "@/components/account/LibraryShell";

export default function BibliotecaLayout({ children }: { children: ReactNode }) {
  return <LibraryShell>{children}</LibraryShell>;
}
