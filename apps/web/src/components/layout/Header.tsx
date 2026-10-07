"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { useErrorText } from "@/lib/error-text";
import { initials, short } from "@/lib/format";
import { useSession } from "@/lib/session";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

// `key` aponta para common.json -> nav.<key> (rótulo) e nav.<key>Short (rótulo curto da barra inferior).
type NavItem = { href: string; key: "explore" | "resale" | "library" | "guarantees" | "creators"; icon: IconName };

export const NAV: NavItem[] = [
  { href: "/", key: "explore", icon: "home" },
  { href: "/resale", key: "resale", icon: "tag" },
  { href: "/library", key: "library", icon: "library" },
  { href: "/guarantees", key: "guarantees", icon: "shield-check" },
  { href: "/creator", key: "creators", icon: "pen" },
];

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/solvers") || pathname.startsWith("/creators");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Logo() {
  const t = useTranslations("common.header");
  return (
    <Link className="logo" href="/" aria-label={t("logoLabel")}>
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
  const t = useTranslations("common.header");
  const errorText = useErrorText();
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
          login().catch((e: unknown) => toast({ tone: "bad", title: t("signInFailed"), text: errorText(e) }))
        }
      >
        {t("signIn")}
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
      toast({ tone: "bad", title: fail, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="acct" ref={box}>
      <button type="button" className="me-pill" aria-expanded={open} aria-controls="menu-conta" onClick={() => setOpen(!open)} aria-label={t("myAccount", { name })}>
        <span className="av av-s">{me.displayName ? initials(name) : me.wallet.slice(0, 2).toUpperCase()}</span>
        <span className="me-name">{first}</span>
      </button>
      {open ? (
        <div className="acct-menu card" id="menu-conta">
          <div className="acct-who">
            <b className="trunc" style={{ display: "block" }}>
              {me.displayName ?? (walletKind === "dev" ? t("testWallet") : t("yourAccount"))}
            </b>
            <span className="tiny faint">
              {me.email ? `${me.email} · ` : ""}
              <span className="mono">{short(me.wallet)}</span>
            </span>
          </div>
          <Link href="/profile">
            <Icon name="user" size="s" />
            {t("myProfile")}
          </Link>
          <Link href="/library">
            <Icon name="library" size="s" />
            {t("myLibrary")}
          </Link>
          {walletKind === "dev" ? (
            <button type="button" disabled={busy} onClick={act(switchDevWallet, t("switchWalletFailed"))}>
              <Icon name="wallet" size="s" />
              {t("useOtherTestWallet")}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={act(logout, t("signOutFailed"))}>
            <Icon name="arrow-right" size="s" />
            {t("signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const t = useTranslations("common");
  return (
    <header className="nav">
      <div className="wrap">
        <Logo />
        <nav className="nav-links" aria-label={t("header.mainNav")}>
          {NAV.map((n) => {
            const on = isActive(pathname, n.href);
            return (
              <Link key={n.href} href={n.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                {t(`nav.${n.key}`)}
              </Link>
            );
          })}
        </nav>
        <div className="nav-actions">
          <LocaleSwitcher />
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
  const t = useTranslations("common");
  return (
    <nav className="tabbar" aria-label={t("header.tabbar")}>
      {NAV.map((n) => {
        const on = isActive(pathname, n.href);
        return (
          <Link key={n.href} href={n.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
            <Icon name={n.icon} size="l" />
            <span>{t(`nav.${n.key}Short`)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
