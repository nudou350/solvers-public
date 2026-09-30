import type { CreatorDashboard } from "@solvers/api-client";
import { int } from "@/lib/format";
import { gap } from "@/lib/style";

type Day = { date: string; sales: number; uses: number };

/** Completa os últimos 30 dias (a API só traz os dias com movimento). */
export function fillDays(daily: CreatorDashboard["daily"], days = 30, now = new Date()): Day[] {
  const by = new Map(daily.map((d) => [d.date, d]));
  const out: Day[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const d = by.get(key);
    out.push({ date: key, sales: d?.sales ?? 0, uses: d?.uses ?? 0 });
  }
  return out;
}

const W = 600;
const H = 160;

/**
 * Vendas (barras, cor da marca) e usos (linha, verde) por dia, cada série na própria escala,
 * como o gráfico "Receita por dia" do design.
 */
export function DailyChart({ daily }: { daily: CreatorDashboard["daily"] }) {
  const days = fillDays(daily);
  const maxSales = Math.max(1, ...days.map((d) => d.sales));
  const maxUses = Math.max(1, ...days.map((d) => d.uses));
  const slot = W / days.length;
  const bw = Math.max(2, slot - 4);
  const pts = days.map((d, i) => [i * slot + slot / 2, 6 + (1 - d.uses / maxUses) * (H - 12)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const totalSales = days.reduce((s, d) => s + d.sales, 0);
  const totalUses = days.reduce((s, d) => s + d.uses, 0);
  const label = `Vendas e usos por dia nos últimos 30 dias: ${int(totalSales)} vendas e ${int(totalUses)} usos.`;
  const fmtDay = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

  return (
    <div className="col" style={gap(16)}>
      <div className="row between wrapx">
        <h2 className="h3">Vendas e usos por dia</h2>
        <div className="row" style={gap(16)}>
          <span className="row small muted" style={gap(6)}>
            <i style={{ width: 12, height: 12, borderRadius: 3, background: "var(--brand)" }} />
            Vendas
          </span>
          <span className="row small muted" style={gap(6)}>
            <i style={{ width: 14, height: 3, borderRadius: 2, background: "var(--mint)" }} />
            Usos
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label={label} style={{ display: "block", overflow: "visible" }}>
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {days.map((d, i) => {
          const h = d.sales ? Math.max(3, (H * d.sales) / maxSales) : 0;
          return (
            <g key={d.date}>
              <title>{`${fmtDay(d.date)}: ${int(d.sales)} vendas, ${int(d.uses)} usos`}</title>
              {/* área de toque/hover do dia inteiro */}
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {h ? <rect x={i * slot + (slot - bw) / 2} y={H - h} width={bw} height={h} rx={3} fill="var(--brand)" /> : null}
            </g>
          );
        })}
        {totalUses ? (
          <path d={line} fill="none" stroke="var(--mint)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ) : null}
      </svg>
      <div className="row between tiny faint wrapx" style={gap(8)}>
        <span>30 dias atrás</span>
        <span>
          Máximo em um dia: {int(maxSales === 1 && !totalSales ? 0 : maxSales)} vendas · {int(maxUses === 1 && !totalUses ? 0 : maxUses)} usos
        </span>
        <span>Hoje</span>
      </div>
    </div>
  );
}
