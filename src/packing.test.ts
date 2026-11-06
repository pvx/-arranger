import { describe, expect, it } from 'vitest';
import {
  computeStats,
  exactPack,
  expand,
  firstFit,
  fmt,
  lowerBound,
  pack,
  parseLength,
  parseSegments,
  placementJson,
  validate,
  type Row,
} from './packing';

const rows: Row[] = [
  { id: 'a', name: 'A', length: '1.2', qty: '2' },
  { id: 'b', name: 'B', length: '2.5', qty: '1' },
  { id: 'c', name: 'C', length: '2.5', qty: '1' },
  { id: 'd', name: 'D', length: '1.3', qty: '1' },
  { id: 'e', name: 'E', length: '2.2', qty: '1' },
];

// Детерминированный ГПСЧ для воспроизводимых прогонов.
function lcg(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const perms = <T,>(a: T[]): T[][] =>
  a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));

describe('pack (начальные данные, 200 случайных порядков)', () => {
  const { R, positions, errors } = validate('3', rows);
  const rand = lcg(42);
  const runs = Array.from({ length: 200 }, () => pack(positions, R, rand));

  it('валидные данные', () => expect(errors).toEqual([]));

  it('каждый экземпляр размещён ровно один раз', () => {
    const expected = expand(positions).map((p) => p.key).sort();
    for (const r of runs) {
      expect(r.stocks.flatMap((s) => s.pieces.map((p) => p.key)).sort()).toEqual(expected);
    }
  });

  it('ни одна заготовка не переполнена, used совпадает с суммой', () => {
    for (const r of runs)
      for (const s of r.stocks) {
        expect(s.used).toBeLessThanOrEqual(R);
        expect(s.used).toBe(s.pieces.reduce((a, p) => a + p.len, 0));
      }
  });

  it('сумма размещённых длин равна сумме входных', () => {
    for (const r of runs) expect(r.stocks.reduce((a, s) => a + s.used, 0)).toBe(10900);
  });

  it('статистика и суммарный остаток по формуле', () => {
    for (const r of runs) {
      const st = r.stats;
      expect(st.totalSegments).toBe(6);
      expect(st.totalLength).toBe(10900);
      expect(st.totalStockLength).toBe(st.stockCount * 3000);
      expect(st.totalWaste).toBe(st.totalStockLength - st.totalLength);
      expect(st.totalWaste).toBe(r.stocks.reduce((a, s) => a + (R - s.used), 0));
      expect(st.utilization).toBeCloseTo((10900 / st.totalStockLength) * 100);
    }
  });

  it('first fit по порядку: экземпляр не помещался ни в одну более раннюю заготовку', () => {
    for (const r of runs) {
      const where = new Map(r.stocks.flatMap((s, i) => s.pieces.map((p) => [p.key, i] as const)));
      const used = r.stocks.map(() => 0);
      for (const p of r.order) {
        const i = where.get(p.key)!;
        for (let j = 0; j < i; j++) expect(used[j] + p.len).toBeGreaterThan(R);
        used[i] += p.len;
      }
    }
  });
});

describe('граничные случаи', () => {
  it('отрезок длиной ровно R занимает целую заготовку', () => {
    const v = validate('3', [{ id: 'x', name: 'X', length: '3', qty: '2' }]);
    expect(v.errors).toEqual([]);
    const r = pack(v.positions, v.R);
    expect(r.stocks.map((s) => s.used)).toEqual([3000, 3000]);
    expect(r.stats.totalWaste).toBe(0);
    expect(r.stats.utilization).toBe(100);
  });

  it('отрезок длиннее R отклоняется с указанием позиции', () => {
    const v = validate('3', [{ id: 'x', name: 'Длинный', length: '3,001', qty: '1' }]);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toContain('Длинный');
    expect(() => firstFit(expand(v.positions), v.R)).toThrow();
  });

  it('десятичные длины без погрешностей: 0.1 + 0.2 = 0.3', () => {
    const v = validate('0.3', [
      { id: 'a', name: 'A', length: '0.1', qty: '1' },
      { id: 'b', name: 'B', length: '0,2', qty: '1' },
    ]);
    const r = pack(v.positions, v.R);
    expect(r.stocks).toHaveLength(1);
    expect(r.stats.totalWaste).toBe(0);
    expect(fmt(r.stats.totalLength)).toBe('0.3');
  });

  it('разбор чисел', () => {
    expect(parseLength('1.2')).toBe(1200);
    expect(parseLength('1,25')).toBe(1250);
    expect(parseLength(' 0.001 ')).toBe(1);
    expect(parseLength('0')).toBeNull();
    expect(parseLength('-1')).toBeNull();
    expect(parseLength('1.2345')).toBeNull();
    expect(parseLength('abc')).toBeNull();
    expect(fmt(2500)).toBe('2.5');
    expect(fmt(3000)).toBe('3');
  });

  it('невалидные R и количество', () => {
    expect(validate('0', rows).errors).toHaveLength(1);
    expect(validate('3', [{ id: 'a', name: 'A', length: '1', qty: '1.5' }]).errors).toHaveLength(1);
    expect(validate('3', [{ id: 'a', name: 'A', length: '1', qty: '0' }]).errors).toHaveLength(1);
  });

  it('parseSegments: valid object and missing qty', () => {
    const ids = ['id1', 'id2'];
    let i = 0;
    const ok = parseSegments({ r: '3', rows: [{ name: 'A', length: '1.2', qty: '2' }] }, () => ids[i++]);
    expect(ok).toEqual({ r: '3', rows: [{ id: 'id1', name: 'A', length: '1.2', qty: '2' }] });
    expect(parseSegments({ r: '3', rows: [{ name: 'A', length: '1.2' }] }, () => 'x')).toBeNull();
  });

  it('placementJson uses fmt lengths, not milli', () => {
    const v = validate('3', [{ id: 'a', name: 'A', length: '1.2', qty: '1' }]);
    const r = pack(v.positions, v.R, () => 0);
    const j = placementJson(r);
    expect(j.R).toBe('3');
    expect(j.stocks[0].pieces[0].length).toBe('1.2');
    expect(j.stats.totalLength).toBe('1.2');
    expect(JSON.stringify(j)).not.toContain('1200');
  });

  it('нижняя оценка: R = 3 → 5 (сильнее ⌈10.9/3⌉ = 4), R = 3.7 → 3', () => {
    const v3 = validate('3', rows);
    const v37 = validate('3.7', rows);
    expect(lowerBound(v3.positions, v3.R)).toBe(5);
    expect(lowerBound(v37.positions, v37.R)).toBe(3);
    expect(lowerBound([], 3000)).toBe(0);
  });

  it('нижняя оценка не больше точного оптимума (перебор всех порядков First Fit)', () => {
    const rand = lcg(7);
    for (let t = 0; t < 150; t++) {
      const R = 1000 + Math.floor(rand() * 9000);
      const rs: Row[] = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i) => ({
        id: String(i),
        name: String(i),
        length: fmt(1 + Math.floor(rand() * R)),
        qty: '1',
      }));
      const v = validate(fmt(R), rs);
      expect(v.errors).toEqual([]);
      // Для некоторого порядка First Fit оптимален, поэтому минимум по всем порядкам = оптимум.
      const opt = Math.min(...perms(expand(v.positions)).map((o) => firstFit(o, v.R).length));
      expect(lowerBound(v.positions, v.R)).toBeLessThanOrEqual(opt);
    }
  });

  it('точный перебор совпадает с перебором всех порядков и даёт корректное размещение', () => {
    const rand = lcg(11);
    for (let t = 0; t < 150; t++) {
      const R = 1000 + Math.floor(rand() * 9000);
      const rs: Row[] = Array.from({ length: 2 + Math.floor(rand() * 5) }, (_, i) => ({
        id: String(i),
        name: String(i),
        length: fmt(1 + Math.floor(rand() * R)),
        qty: '1',
      }));
      const v = validate(fmt(R), rs);
      const opt = Math.min(...perms(expand(v.positions)).map((o) => firstFit(o, v.R).length));
      const ex = exactPack(v.positions, v.R);
      expect(ex.proven).toBe(true);
      expect(ex.result.stats.stockCount).toBe(opt);
      expect(ex.result.stocks.flatMap((s) => s.pieces.map((p) => p.key)).sort()).toEqual(expand(v.positions).map((p) => p.key).sort());
      for (const s of ex.result.stocks) expect(s.used).toBeLessThanOrEqual(v.R);
    }
  });

  it('точный перебор на начальных данных: R = 3 → 5, R = 3.7 → 3', () => {
    for (const [r, n] of [['3', 5], ['3.7', 3]] as const) {
      const v = validate(r, rows);
      const ex = exactPack(v.positions, v.R);
      expect(ex).toMatchObject({ proven: true, result: { stats: { stockCount: n } } });
    }
  });

  it('точный перебор при исчерпании лимита не заявляет доказательство', () => {
    // Ищем данные, где First Fit по убыванию не достигает оценки, — там нужен перебор.
    const rand = lcg(3);
    let checked = 0;
    for (let t = 0; t < 500; t++) {
      const rs: Row[] = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: String(i), length: fmt(1 + Math.floor(rand() * 10000)), qty: '1' }));
      const v = validate('10', rs);
      const ffd = firstFit(expand(v.positions).sort((a, b) => b.len - a.len), v.R).length;
      if (ffd === lowerBound(v.positions, v.R)) continue;
      expect(exactPack(v.positions, v.R, 0).proven).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('пустой список: 0 заготовок, использование 0', () => {
    const st = computeStats([], firstFit([], 3000), 3000);
    expect(st).toMatchObject({ totalSegments: 0, stockCount: 0, totalWaste: 0, utilization: 0 });
  });
});
