import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Use estes no lugar de next/link e de useRouter/usePathname/redirect de next/navigation: mantêm o prefixo do idioma.
// notFound, useSearchParams e useParams continuam vindo de next/navigation.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
