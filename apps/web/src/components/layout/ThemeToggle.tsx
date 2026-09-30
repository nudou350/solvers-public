"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

export type Theme = "light" | "dark";
export const THEME_KEY = "solvers.theme";

/**
 * Script que roda antes da pintura (no início do <body>): aplica o tema salvo, ou o do sistema,
 * para não piscar o tema errado. Mantido pequeno e sem dependências.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.body.setAttribute("data-theme",t)}catch(e){}})();`;

export function setTheme(t: Theme) {
  document.body.setAttribute("data-theme", t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* sem localStorage: vale só nesta aba */
  }
}

/** Botão sol/lua do cabeçalho. Persiste a escolha no localStorage. */
export function ThemeToggle() {
  const [theme, setState] = useState<Theme | null>(null);
  useEffect(() => {
    // Acompanha o atributo do <body>, para ficar certo se outro lugar trocar o tema.
    const read = () => setState(document.body.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}
      title={dark ? "Usar tema claro" : "Usar tema escuro"}
      onClick={() => {
        const next: Theme = dark ? "light" : "dark";
        setTheme(next);
        setState(next);
      }}
    >
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}
