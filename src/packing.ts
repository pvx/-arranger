// Алгоритм размещения и статистика. Все длины — целые тысячные доли единицы (milli).

export type Row = { id: string; name: string; length: string; qty: string };
export type Position = { id: string; name: string; len: number; qty: number; color: string };
export type Piece = { key: string; posId: string; label: string; len: number; color: string };
export type Stock = { pieces: Piece[]; used: number };
export type Stats = {
  totalSegments: number;
  totalLength: number;
  stockCount: number;
  totalStockLength: number;
  totalWaste: number;
  utilization: number;
};

/** "1.2" / "1,2" → 1200. До 3 знаков после запятой, только положительные. */
export function parseLength(s: string): number | null {
  const m = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  return v > 0 && Number.isSafeInteger(v) ? v : null;
}

export const MAX_QTY = 1000;

export function parseQty(s: string): number | null {
  if (!/^\d+$/.test(s.trim())) return null;
  const v = Number(s);
  return v > 0 && v <= MAX_QTY ? v : null;
}

/** 2500 → "2.5", 3000 → "3". */
export const fmt = (milli: number) => String(milli / 1000);
export const pct = (x: number) => String(Math.round(x * 10) / 10);
export const colorFor = (i: number) => `hsl(${Math.round(i * 137.508) % 360} 70% 72%)`;
export const displayName = (name: string, i: number) => name.trim() || `#${i + 1}`;

export function validate(rStr: string, rows: Row[]) {
  const errors: string[] = [];
  const R = parseLength(rStr);
  if (R === null) errors.push('Stock length R must be a positive number (at most 3 decimal places).');
  const positions: Position[] = [];
  rows.forEach((row, i) => {
    const name = displayName(row.name, i);
    const len = parseLength(row.length);
    const qty = parseQty(row.qty);
    if (len === null) errors.push(`Item "${name}": length must be a positive number (at most 3 decimal places).`);
    if (qty === null) errors.push(`Item "${name}": quantity must be an integer from 1 to ${MAX_QTY}.`);
    if (len !== null && R !== null && len > R)
      errors.push(`Item "${name}": length ${fmt(len)} is greater than stock length R = ${fmt(R)}. That segment does not fit.`);
    if (len !== null && qty !== null) positions.push({ id: row.id, name, len, qty, color: colorFor(i) });
  });
  return { R: R ?? 0, positions, errors };
}

/** JSON shape for import/export of R + rows (no internal ids). Returns null if the object is not that shape. */
export function parseSegments(data: unknown, newId: () => string): { r: string; rows: Row[] } | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as { r?: unknown; rows?: unknown };
  if (typeof o.r !== 'string' || !Array.isArray(o.rows)) return null;
  const rows: Row[] = [];
  for (const row of o.rows) {
    if (!row || typeof row !== 'object') return null;
    const r = row as { name?: unknown; length?: unknown; qty?: unknown };
    if (typeof r.name !== 'string' || typeof r.length !== 'string' || typeof r.qty !== 'string') return null;
    rows.push({ id: newId(), name: r.name, length: r.length, qty: r.qty });
  }
  return { r: o.r, rows };
}

/** A (qty 2) → A-1, A-2. */
export function expand(positions: Position[]): Piece[] {
  return positions.flatMap((p) =>
    Array.from({ length: p.qty }, (_, k) => ({
      key: `${p.id}#${k + 1}`,
      posId: p.id,
      label: `${p.name}-${k + 1}`,
      len: p.len,
      color: p.color,
    })),
  );
}

/** Fisher–Yates, возвращает новый массив. */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** First Fit в заданном порядке: первая по порядку создания заготовка, где хватает места, иначе новая. */
export function firstFit(pieces: Piece[], R: number): Stock[] {
  const stocks: Stock[] = [];
  for (const p of pieces) {
    if (p.len > R) throw new Error(`Segment ${p.label} (${fmt(p.len)}) is longer than stock R = ${fmt(R)}`);
    const s = stocks.find((s) => s.used + p.len <= R);
    if (s) {
      s.pieces.push(p);
      s.used += p.len;
    } else stocks.push({ pieces: [p], used: p.len });
  }
  return stocks;
}

export function computeStats(positions: Position[], stocks: Stock[], R: number): Stats {
  const totalSegments = positions.reduce((s, p) => s + p.qty, 0);
  const totalLength = positions.reduce((s, p) => s + p.len * p.qty, 0);
  const stockCount = stocks.length;
  const totalStockLength = stockCount * R;
  return {
    totalSegments,
    totalLength,
    stockCount,
    totalStockLength,
    totalWaste: totalStockLength - totalLength,
    utilization: totalStockLength ? (totalLength / totalStockLength) * 100 : 0,
  };
}

/**
 * Нижняя оценка числа заготовок (Martello–Toth L2): меньше заготовок не бывает ни при каком размещении.
 * Для порога a: отрезки > R−a не делят заготовку ни с кем из ≥ a; отрезки > R/2 — каждый в своей;
 * отрезки из [a, R/2] должны уместиться в свободное место заготовок с отрезками > R/2 или в новые.
 */
export function lowerBound(positions: Position[], R: number): number {
  const lens = positions.flatMap((p) => Array<number>(p.qty).fill(p.len));
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const ceilDiv = (a: number) => Math.max(0, Math.ceil(a / R));
  let lb = ceilDiv(sum(lens));
  const thresholds = new Set([0, ...positions.map((p) => p.len).filter((x) => 2 * x <= R)]);
  for (const a of thresholds) {
    const j1 = lens.filter((x) => x > R - a).length;
    const j2 = lens.filter((x) => x <= R - a && 2 * x > R);
    const j3 = lens.filter((x) => 2 * x <= R && x >= a);
    lb = Math.max(lb, j1 + j2.length + ceilDiv(sum(j3) - (j2.length * R - sum(j2))));
  }
  return lb;
}

function packOrder(positions: Position[], R: number, order: Piece[]) {
  const stocks = firstFit(order, R);
  return { R, order, stocks, stats: computeStats(positions, stocks, R) };
}

export function pack(positions: Position[], R: number, rand: () => number = Math.random) {
  return packOrder(positions, R, shuffle(expand(positions), rand));
}

export type PackResult = ReturnType<typeof pack>;

/** Placement as display strings (fmt lengths), for download. */
export function placementJson(result: PackResult) {
  return {
    R: fmt(result.R),
    stocks: result.stocks.map((s) => ({
      pieces: s.pieces.map((p) => ({ label: p.label, length: fmt(p.len) })),
      used: fmt(s.used),
      waste: fmt(result.R - s.used),
    })),
    order: result.order.map((p) => p.label),
    stats: {
      segments: result.stats.totalSegments,
      totalLength: fmt(result.stats.totalLength),
      stocks: result.stats.stockCount,
      totalStockLength: fmt(result.stats.totalStockLength),
      waste: fmt(result.stats.totalWaste),
      utilization: pct(result.stats.utilization),
    },
  };
}

/**
 * Точный перебор (ветви и границы). proven = true — найденное число заготовок оптимально.
 * Если перебор упёрся в лимит узлов, возвращается лучшее найденное и proven = false.
 * Найденное размещение отдаётся как порядок «заготовка за заготовкой»: First Fit на таком
 * порядке не использует больше заготовок, поэтому результат согласован с основным алгоритмом.
 */
// ponytail: считается синхронно в UI-потоке; лимит держит паузу в пределах ~секунды. Для больших задач — Web Worker или ILP.
export const EXACT_LIMIT = 10_000_000;

export function exactPack(positions: Position[], R: number, limit = EXACT_LIMIT) {
  const items = expand(positions).sort((a, b) => b.len - a.len);
  const lb = lowerBound(positions, R);
  const suffix = new Array<number>(items.length + 1).fill(0);
  for (let i = items.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + items[i].len;
  let best = firstFit(items, R).map((s) => s.pieces); // старт: First Fit по убыванию
  const bins: Piece[][] = [];
  const used: number[] = [];
  let usedSum = 0;
  let nodes = 0;
  let aborted = false;

  // true — остановить перебор (оптимум равен оценке или исчерпан лимит).
  function rec(i: number): boolean {
    // Даже заполнив всё свободное место, остаток потребует новых заготовок.
    const extra = Math.max(0, Math.ceil((suffix[i] - (bins.length * R - usedSum)) / R));
    if (bins.length + extra >= best.length) return false;
    if (i === items.length) {
      best = bins.map((b) => b.slice());
      return best.length === lb;
    }
    if (++nodes > limit) return (aborted = true);
    const it = items[i];
    const tried = new Set<number>(); // заготовки с одинаковым заполнением равнозначны
    for (let b = 0; b < bins.length; b++) {
      if (used[b] + it.len > R || tried.has(used[b])) continue;
      tried.add(used[b]);
      used[b] += it.len;
      usedSum += it.len;
      bins[b].push(it);
      if (rec(i + 1)) return true;
      used[b] -= it.len;
      usedSum -= it.len;
      bins[b].pop();
    }
    bins.push([it]);
    used.push(it.len);
    usedSum += it.len;
    if (rec(i + 1)) return true;
    bins.pop();
    used.pop();
    usedSum -= it.len;
    return false;
  }

  if (best.length > lb) rec(0);
  return { result: packOrder(positions, R, best.flat()), proven: !aborted, nodes };
}
