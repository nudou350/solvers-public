// QR de mentira para o Pix simulado (qrCodeBase64 vem null): parece um QR, mas não é legível.
const N = 29;

function seedOf(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h || 1;
}

function finder(x: number, y: number, i: number, j: number) {
  const dx = i - x;
  const dy = j - y;
  if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return null;
  const edge = dx === 0 || dy === 0 || dx === 6 || dy === 6;
  const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
  return edge || core;
}

export function FakeQr({ text, size = 200 }: { text: string; size?: number }) {
  let s = seedOf(text);
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  let d = "";
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const f = finder(0, 0, i, j) ?? finder(N - 7, 0, i, j) ?? finder(0, N - 7, i, j);
      const inQuiet = (i <= 7 && j <= 7) || (i >= N - 8 && j <= 7) || (i <= 7 && j >= N - 8);
      const on = f ?? (inQuiet ? false : rnd() > 0.52);
      if (on) d += `M${i} ${j}h1v1h-1z`;
    }
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${N + 4} ${N + 4}`} role="img" aria-label="QR Code de teste (não pode ser pago)" shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={N + 4} height={N + 4} fill="#fff" />
      <path d={d} fill="#111" />
    </svg>
  );
}
