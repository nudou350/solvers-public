"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { initials, short } from "@/lib/format";
import { useSession } from "@/lib/session";
import { ThemeToggle } from "./ThemeToggle";

type NavItem = { href: string; label: string; short: string; icon: IconName };

export const NAV: NavItem[] = [
  { href: "/", label: "Explorar", short: "Explorar", icon: "home" },
  { href: "/revenda", label: "Revenda", short: "Revenda", icon: "tag" },
  { href: "/biblioteca", label: "Minha biblioteca", short: "Biblioteca", icon: "library" },
  { href: "/garantias", label: "Garantias", short: "Garantias", icon: "shield-check" },
  { href: "/criador", label: "Para criadores", short: "Criador", icon: "pen" },
];

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/especialistas") || pathname.startsWith("/criadores");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Logo() {
  return (
    <Link className="logo" href="/" aria-label="Solver, página inicial">
      <span className="logo-mark">
        <Icon name="diamond" size="s" />
      </span>
      <span>Solver</span>
    </Link>
  );
}

function Account() {
  const { status, me, login, loggingIn } = useSession();
  const toast = useToast();
  if (status === "loading") return <span className="me-pill" aria-hidden style={{ width: 44, padding: 4 }} />;
  if (!me)
    return (
      <Button
        variant="primary"
        loading={loggingIn}
        onClick={() =>
          login().catch((e: unknown) => toast({ tone: "bad", title: "Não deu para entrar", text: (e as Error).message }))
        }
      >
        Entrar
      </Button>
    );
  const name = me.displayName ?? short(me.wallet);
  const first = me.displayName ? me.displayName.split(" ")[0] : short(me.wallet);
  return (
    <Link className="me-pill" href="/perfil" aria-label="Meu perfil">
      <span className="av av-s">{me.displayName ? initials(name) : me.wallet.slice(0, 2).toUpperCase()}</span>
      <span className="me-name">{first}</span>
    </Link>
  );
}

export function Header() {
  const pathname = usePathname() ?? "/";
  return (
    <header className="nav">
      <div className="wrap">
        <Logo />
        <nav className="nav-links" aria-label="Principal">
          {NAV.map((n) => {
            const on = isActive(pathname, n.href);
            return (
              <Link key={n.href} href={n.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="nav-actions">
          <ThemeToggle />
          <Account />
        </div>
      </div>
    </header>
  );
}

/** Barra de navegação inferior (só no celular, pelo CSS do design). */
export function TabBar() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="tabbar" aria-label="Navegação">
      {NAV.map((n) => {
        const on = isActive(pathname, n.href);
        return (
          <Link key={n.href} href={n.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
            <Icon name={n.icon} size="l" />
            <span>{n.short}</span>
          </Link>
        );
      })}
    </nav>
  );
}
