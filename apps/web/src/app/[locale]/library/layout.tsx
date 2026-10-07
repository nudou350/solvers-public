import type { ReactNode } from "react";
import { LibraryShell } from "@/components/account/LibraryShell";

export default function LibraryLayout({ children }: { children: ReactNode }) {
  return <LibraryShell>{children}</LibraryShell>;
}
