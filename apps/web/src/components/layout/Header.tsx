"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
    <Link className="logo" href="/" aria-label="Solvers, página inicial">
      <span className="logo-mark">
        <Icon name="diamond" size="s" />
      </span>
      <span>Solvers</span>
    </Link>
  );
}

function Account() {
  const { status, me, login, loggingIn, logout, walletKind, switchDevWallet } = useSession();
  const toast = useToast();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Fecha ao navegar, ao clicar fora e com Esc.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  const act = (fn: () => Promise<unknown>, fail: string) => async () => {
    setBusy(true);
    try {
      await fn();
      setOpen(false);
    } catch (e) {
      toast({ tone: "bad", title: fail, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="acct" ref={box}>
      <button type="button" className="me-pill" aria-expanded={open} aria-controls="menu-conta" onClick={() => setOpen(!open)} aria-label={`Minha conta: ${name}`}>
        <span className="av av-s">{me.displayName ? initials(name) : me.wallet.slice(0, 2).toUpperCase()}</span>
        <span className="me-name">{first}</span>
      </button>
      {open ? (
        <div className="acct-menu card" id="menu-conta">
          <div className="acct-who">
            <b className="trunc" style={{ display: "block" }}>
              {me.displayName ?? (walletKind === "dev" ? "Carteira de teste" : "Sua conta")}
            </b>
            <span className="tiny faint">
              {me.email ? `${me.email} · ` : ""}
              <span className="mono">{short(me.wallet)}</span>
            </span>
          </div>
          <Link href="/perfil">
            <Icon name="user" size="s" />
            Meu perfil
          </Link>
          <Link href="/biblioteca">
            <Icon name="library" size="s" />
            Minha biblioteca
          </Link>
          {walletKind === "dev" ? (
            <button type="button" disabled={busy} onClick={act(switchDevWallet, "Não deu para trocar de carteira")}>
              <Icon name="wallet" size="s" />
              Usar outra carteira de teste
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={act(logout, "Não deu para sair")}>
            <Icon name="arrow-right" size="s" />
            Sair
          </button>
        </div>
      ) : null}
    </div>
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
