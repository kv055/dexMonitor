import { useEffect, useState } from 'react';
import { useTimezone } from '../hooks/useTimezone';
import { apiFetch } from '../api/client';
import { formatDateTimeParts } from '../utils/formatters';

interface ExchangeData {
  count: number;
  ids?: string[];
}

interface LogEntry {
  id: number;
  timestamp: string;
  exchanges: Record<string, ExchangeData>;
  offers_count: number;
}

const EXCHANGE_COLOR: Record<string, string> = {
  bisq: '#f7931a',
  bisq2: '#58a6ff',
  hodlhodl: '#4caf82',
  robosats: '#9b59b6',
  peachbitcoin: '#FF6B35',
};

const EXPECTED_EXCHANGES = ['bisq', 'bisq2', 'hodlhodl', 'robosats', 'peachbitcoin'];

function exchangeColor(name: string) {
  return EXCHANGE_COLOR[name] ?? '#888';
}

function exchangeLabel(name: string) {
  if (name === 'bisq') return 'Bisq v1';
  if (name === 'bisq2') return 'Bisq v2';
  if (name === 'hodlhodl') return 'HodlHodl';
  if (name === 'robosats') return 'RoboSats';
  if (name === 'peachbitcoin') return 'Peach Bitcoin';
  return name;
}

function exchangeNamesForEntry(entry: LogEntry) {
  const names = [...EXPECTED_EXCHANGES];
  const present = Object.keys(entry.exchanges ?? {}).sort((a, b) => a.localeCompare(b));
  for (const name of present) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function exchangeSummary(name: string, data?: ExchangeData) {
  if (!data) return `${exchangeLabel(name)}: offline`;
  if (data.count === 0) return `${exchangeLabel(name)}: queried, 0 offers`;
  return `${exchangeLabel(name)}: ${data.count} ${data.count === 1 ? 'offer' : 'offers'}`;
}

function exchangeDotClass(data?: ExchangeData) {
  if (!data) return 'opacity-35 ring-1 ring-muted/60';
  if (data.count === 0) return 'opacity-45 ring-1 ring-white/25';
  return 'opacity-100';
}

export function SnapshotLog() {
  const { timezone } = useTimezone();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  // key: `${entryId}:${exchange}`
  const [expandedExchange, setExpandedExchange] = useState<string | null>(null);

  function toggleExchange(key: string) {
    setExpandedExchange(prev => prev === key ? null : key);
  }

  async function ensureDetail(entry: LogEntry) {
    if (Object.values(entry.exchanges ?? {}).some(ex => ex.ids)) return;
    setDetailLoading(entry.id);
    try {
      const detail = await apiFetch<LogEntry>(`/api/snapshot-log/${entry.id}`);
      setEntries(prev => prev.map(item => item.id === detail.id ? detail : item));
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load snapshot detail';
      setError(message);
    } finally {
      setDetailLoading(prev => prev === entry.id ? null : prev);
    }
  }

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await apiFetch<LogEntry[]>('/api/snapshot-log?limit=20&compact=true');
        if (!active) return;
        setEntries(data);
        setError(null);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Failed to load snapshot log';
        setError(message);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto flex flex-col gap-0.5">
      {loading && (
        <span className="text-muted text-[0.75rem] px-1">Loading snapshot log…</span>
      )}
      {!loading && error && (
        <span className="text-red text-[0.75rem] px-1">{error}</span>
      )}
      {!loading && !error && entries.length === 0 && (
        <span className="text-muted text-[0.75rem]">No snapshot runs yet.</span>
      )}
      {!error && entries.map(e => {
        const { day: dateStr, time: timeStr } = formatDateTimeParts(e.timestamp, timezone);
        const isOpen = expanded === e.id;
        const exchangeNames = exchangeNamesForEntry(e);

        return (
          <div key={e.id} className="border-b border-border last:border-0">
            <button
              onClick={() => {
                const nextOpen = !isOpen;
                setExpanded(nextOpen ? e.id : null);
                if (nextOpen) void ensureDetail(e);
              }}
              className="w-full flex items-center gap-2 text-[0.75rem] py-1 bg-transparent border-none cursor-pointer text-left hover:bg-white/5 rounded px-1 transition-colors"
            >
              <span className="text-muted shrink-0 w-26">{dateStr} {timeStr}</span>
              <div className="flex gap-1 shrink-0">
                {exchangeNames.map(ex => {
                  const exchange = e.exchanges?.[ex];
                  return (
                    <span
                      key={ex}
                      title={exchangeSummary(ex, exchange)}
                      className={`w-1.5 h-1.5 rounded-full inline-block ${exchangeDotClass(exchange)}`}
                      style={{ background: exchange ? exchangeColor(ex) : 'transparent' }}
                    />
                  );
                })}
              </div>
              <span className="text-text">{e.offers_count} offers</span>
              <span className="ml-auto text-muted">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="flex flex-col gap-0.5 px-1 pb-2 pt-0.5">
                {detailLoading === e.id && (
                  <div className="px-1 py-1 text-[0.7rem] text-muted">Loading IDs…</div>
                )}
                {exchangeNames.map(ex => {
                  const exKey = `${e.id}:${ex}`;
                  const exOpen = expandedExchange === exKey;
                  const exchange = e.exchanges?.[ex];
                  const ids = exchange?.ids ?? [];
                  return (
                    <div key={ex}>
                      <button
                        onClick={() => toggleExchange(exKey)}
                        className="w-full flex items-center gap-2 text-[0.72rem] py-0.5 bg-transparent border-none cursor-pointer text-left hover:bg-white/5 rounded px-1 transition-colors"
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${exchangeDotClass(exchange)}`}
                          style={{ background: exchange ? exchangeColor(ex) : 'transparent' }}
                        />
                        <span className="text-muted w-22">{exchangeLabel(ex)}</span>
                        <span className={exchange ? 'text-text' : 'text-muted'}>
                          {exchange ? `${exchange.count} ${exchange.count === 1 ? 'offer' : 'offers'}` : 'offline'}
                        </span>
                        <span className="ml-auto text-muted">{exOpen ? '▲' : '▼'}</span>
                      </button>
                      {exOpen && (
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 px-4 pb-1.5 pt-0.5">
                          {ids.length > 0 ? ids.map(id => (
                            <span key={id} className="text-[0.65rem] text-muted font-mono">{id}</span>
                          )) : (
                            <span className="text-[0.65rem] text-muted">
                              {exchange ? 'No offer IDs in this snapshot.' : 'Exchange was not reported by this snapshot run.'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
