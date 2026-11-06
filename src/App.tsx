import { useEffect, useMemo, useRef, useState } from 'react';
import {
  colorFor,
  exactPack,
  fmt,
  lowerBound,
  pack,
  parseSegments,
  pct,
  placementJson,
  validate,
  type PackResult,
  type Row,
} from './packing';

type Input = { r: string; rows: Row[] };
type Run = { n: number; result: PackResult; exact?: boolean };

const STORAGE_KEY = 'aranger-input-v1';
const RUNS_KEY = 'aranger-runs-v1';
const MAX_RUNS = 100000;
const parseRuns = (s: string) => (/^\d+$/.test(s.trim()) && +s >= 1 && +s <= MAX_RUNS ? +s : null);
const DEFAULT_INPUT: Input = {
  r: '3',
  rows: [
    { id: 'a', name: 'A', length: '1.2', qty: '2' },
    { id: 'b', name: 'B', length: '2.5', qty: '1' },
    { id: 'c', name: 'C', length: '2.5', qty: '1' },
    { id: 'd', name: 'D', length: '1.3', qty: '1' },
    { id: 'e', name: 'E', length: '2.2', qty: '1' },
  ],
};

function loadInput(): Input {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (s && typeof s.r === 'string' && Array.isArray(s.rows)) return s;
  } catch {}
  return DEFAULT_INPUT;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [input, setInput] = useState(loadInput);
  const [result, setResult] = useState<PackResult | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [runCount, setRunCount] = useState(0);
  const [exact, setExact] = useState<{ proven: boolean; count: number; nodes: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [runs, setRuns] = useState(() => {
    try {
      return localStorage.getItem(RUNS_KEY) ?? '1';
    } catch {
      return '1';
    }
  });
  const importRef = useRef<HTMLInputElement>(null);
  const v = useMemo(() => validate(input.r, input.rows), [input]);
  const runsN = parseRuns(runs);
  // Нижняя оценка зависит только от входных данных; для пустого списка не показываем.
  const lb = useMemo(
    () => (v.errors.length || !v.positions.length ? null : lowerBound(v.positions, v.R)),
    [v],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
      localStorage.setItem(RUNS_KEY, runs);
    } catch {}
  }, [input, runs]);

  // Любое изменение входных данных — новый эксперимент.
  function update(next: Input) {
    setInput(next);
    setResult(null);
    setHistory([]);
    setRunCount(0);
    setExact(null);
    setImportError(null);
  }
  const setRow = (id: string, patch: Partial<Row>) =>
    update({ ...input, rows: input.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  // count прогонов; в историю попадают только запуски с новым значением остатка; показываем лучший прогон серии.
  function run(count: number) {
    if (v.errors.length) return;
    let next = history;
    let n = runCount;
    let shown: PackResult | null = null;
    for (let i = 0; i < count; i++) {
      const res = pack(v.positions, v.R);
      n++;
      if (!shown || res.stats.stockCount < shown.stats.stockCount) shown = res;
      if (!next.some((h) => h.result.stats.totalWaste === res.stats.totalWaste)) next = [...next, { n, result: res }];
    }
    setHistory(next);
    setRunCount(n);
    setResult(shown);
  }

  // Одно размещение при открытии (ref защищает от двойного запуска эффекта в StrictMode).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Точный перебор по кнопке; найденное размещение попадает в историю по тем же правилам, что и прогоны.
  function runExact() {
    if (lb === null) return;
    const ex = exactPack(v.positions, v.R);
    setExact({ proven: ex.proven, count: ex.result.stats.stockCount, nodes: ex.nodes });
    setResult(ex.result);
    if (!history.some((h) => h.result.stats.totalWaste === ex.result.stats.totalWaste))
      setHistory([...history, { n: runCount + 1, result: ex.result, exact: true }]);
  }

  function exportSegments() {
    downloadJson('segments.json', {
      r: input.r,
      rows: input.rows.map(({ name, length, qty }) => ({ name, length, qty })),
    });
  }

  function onImportFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseSegments(JSON.parse(String(reader.result)), newId);
        if (!parsed) {
          setImportError('Invalid segments JSON: expected { r, rows: [{ name, length, qty }] }.');
          return;
        }
        update(parsed);
      } catch {
        setImportError('Invalid segments JSON: expected { r, rows: [{ name, length, qty }] }.');
      }
    };
    reader.readAsText(file);
  }

  const best = history.length ? Math.min(...history.map((h) => h.result.stats.stockCount)) : null;
  // Доказанный оптимум: лучший запуск равен нижней оценке или его подтвердил полный перебор.
  const optimum = exact?.proven ? exact.count : lb !== null && best === lb ? lb : null;

  return (
    <main className="app">
      <h1>Place segments on stocks</h1>

      <section className="card">
        <h2>Parameters</h2>
        <label className="r-field">
          Stock length R
          <input inputMode="decimal" value={input.r} onChange={(e) => update({ ...input, r: e.target.value })} />
        </label>

        <div className="table-wrap">
          <table className="rows">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Length</th>
                <th>Quantity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {input.rows.map((row, i) => (
                <tr key={row.id}>
                  <td>
                    <span className="swatch" style={{ background: colorFor(i) }} />
                  </td>
                  <td>
                    <input aria-label="Name" value={row.name} onChange={(e) => setRow(row.id, { name: e.target.value })} />
                  </td>
                  <td>
                    <input aria-label="Length" inputMode="decimal" value={row.length} onChange={(e) => setRow(row.id, { length: e.target.value })} />
                  </td>
                  <td>
                    <input aria-label="Quantity" inputMode="numeric" value={row.qty} onChange={(e) => setRow(row.id, { qty: e.target.value })} />
                  </td>
                  <td>
                    <button
                      className="danger"
                      title="Delete row"
                      aria-label="Delete row"
                      onClick={() => update({ ...input, rows: input.rows.filter((r) => r.id !== row.id) })}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {input.rows.length === 0 && <p className="hint">Add at least one segment</p>}
        {v.errors.length > 0 && (
          <ul className="errors" role="alert">
            {v.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {importError && (
          <p className="errors" role="alert">
            {importError}
          </p>
        )}

        <div className="actions">
          <button
            onClick={() =>
              update({
                ...input,
                rows: [...input.rows, { id: newId(), name: String.fromCharCode(65 + (input.rows.length % 26)), length: '1', qty: '1' }],
              })
            }
          >
            Add segment
          </button>
          <button onClick={exportSegments}>Export JSON</button>
          <button onClick={() => importRef.current?.click()}>Import JSON</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              onImportFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <label className="runs-field">
            Runs
            <input inputMode="numeric" value={runs} onChange={(e) => setRuns(e.target.value)} />
          </label>
          <button className="primary" onClick={() => runsN && run(runsN)} disabled={v.errors.length > 0 || runsN === null}>
            Run random placement
          </button>
        </div>
        {runsN === null && <p className="errors">Runs must be an integer from 1 to {MAX_RUNS}.</p>}
      </section>

      {history.length > 0 && (
        <section className="card">
          <h2>Run history</h2>
          {lb !== null && best !== null && (
            <div className={optimum !== null ? 'proof ok' : 'proof'}>
              {optimum !== null
                ? best === lb
                  ? `Optimum proven: best run uses ${best} stocks, equal to the lower bound ${lb}.`
                  : `Optimum proven by exact search: ${optimum} stocks (lower bound ${lb} is unreachable).`
                : exact
                  ? `Search stopped after ${exact.nodes.toLocaleString()} nodes — optimality not proven. Best found — ${best} stocks, lower bound — ${lb}.`
                  : `Optimality not proven: best run — ${best} stocks, lower bound — ${lb}. Optimum is between ${lb} and ${best}.`}
              {optimum === null && !exact && (
                <button className="proof-btn" onClick={runExact}>
                  Exact search
                </button>
              )}
            </div>
          )}
          <div className="table-wrap">
            <table className="history">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Stocks</th>
                  <th>Waste</th>
                  <th>Utilization</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr
                    key={h.n}
                    className={[h.result.stats.stockCount === best && 'best', h.result === result && 'selected'].filter(Boolean).join(' ')}
                    onClick={() => setResult(h.result)}
                  >
                    <td>
                      <button className="link" title="Show this placement">
                        {h.exact ? 'exact' : h.n}
                      </button>
                    </td>
                    <td>{h.result.stats.stockCount}</td>
                    <td>{fmt(h.result.stats.totalWaste)}</td>
                    <td>{pct(h.result.stats.utilization)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Total runs: {runCount}. Only a run with a new waste value is added to the table. Click a row to show its
            placement. Best runs (fewest stocks) are highlighted.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Placement</h2>
        {!result ? (
          <p className="hint">Input changed. Click “Run random placement”.</p>
        ) : result.stocks.length === 0 ? (
          <p className="hint">Add at least one segment</p>
        ) : (
          <>
            {result.stocks.map((s, i) => (
              <div className="stock" key={i}>
                <div className="stock-label">
                  <b>Stock {i + 1}:</b> used {fmt(s.used)} / {fmt(result.R)}; waste {fmt(result.R - s.used)}; fill{' '}
                  {pct((s.used / result.R) * 100)}%
                </div>
                <div className="bar">
                  {s.pieces.map((p) => (
                    <div
                      key={p.key}
                      className="piece"
                      style={{ width: `${(p.len / result.R) * 100}%`, background: p.color }}
                      title={`${p.label}: ${fmt(p.len)}`}
                    >
                      {p.label} · {fmt(p.len)}
                    </div>
                  ))}
                  {s.used < result.R && (
                    <div className="piece rest" title={`Waste: ${fmt(result.R - s.used)}`}>
                      {fmt(result.R - s.used)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <p className="order">Processing order: {result.order.map((p) => p.label).join(' → ')}</p>
            <div className="actions">
              <button onClick={() => downloadJson('placement.json', placementJson(result))}>Export placement</button>
            </div>
          </>
        )}
      </section>

      {result && (
        <section className="card">
          <h2>Totals</h2>
          <dl className="stats">
            <dt>Segments</dt>
            <dd>{result.stats.totalSegments}</dd>
            <dt>Total segment length</dt>
            <dd>{fmt(result.stats.totalLength)}</dd>
            <dt>Stocks used</dt>
            <dd>{result.stats.stockCount}</dd>
            <dt>Total stock length</dt>
            <dd>{fmt(result.stats.totalStockLength)}</dd>
            <dt>Total waste</dt>
            <dd>{fmt(result.stats.totalWaste)}</dd>
            <dt>Material utilization</dt>
            <dd>{pct(result.stats.utilization)}%</dd>
            {lb !== null && (
              <>
                <dt>Lower bound on stocks</dt>
                <dd>{lb}</dd>
              </>
            )}
          </dl>
          <p className="note">
            {optimum !== null && result.stats.stockCount === optimum
              ? 'This placement is optimal: stock count equals the lower bound; fewer is impossible.'
              : 'This is one random order; optimality is not proven.'}
          </p>
        </section>
      )}
    </main>
  );
}
