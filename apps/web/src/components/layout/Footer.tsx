import Link from "next/link";
import { Logo } from "./Header";

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap row between start m-col-x" style={{ "--gap": "40px" } as React.CSSProperties}>
        <div className="col" style={{ "--gap": "14px", maxWidth: 360 } as React.CSSProperties}>
          <Logo />
          <p className="small muted">
            Especialistas de IA para usar com o Claude e o ChatGPT que você já tem. Compre uma vez e use onde quiser.
          </p>
        </div>
        <div className="row start wrapx" style={{ "--gap": "72px", rowGap: 28 } as React.CSSProperties}>
          <div className="col small" style={{ "--gap": "10px" } as React.CSSProperties}>
            <span className="eyebrow">Explorar</span>
            <Link href="/" className="muted">
              Especialistas
            </Link>
            <Link href="/revenda" className="muted">
              Mercado de revenda <span className="faint">(em breve)</span>
            </Link>
            <Link href="/garantias" className="muted">
              Garantias
            </Link>
          </div>
          <div className="col small" style={{ "--gap": "10px" } as React.CSSProperties}>
            <span className="eyebrow">Criadores</span>
            <Link href="/criador/publicar" className="muted">
              Publicar especialista
            </Link>
            <Link href="/criador" className="muted">
              Painel do criador
            </Link>
          </div>
          <div className="col small" style={{ "--gap": "10px" } as React.CSSProperties}>
            <span className="eyebrow">Confiança</span>
            <Link href="/perfil" className="muted">
              Perfil e reputação
            </Link>
            <span className="sol-chip">
              <i />
              Licenças registradas na rede Solana
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
