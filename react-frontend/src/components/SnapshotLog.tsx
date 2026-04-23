import { useEffect, useState } from 'react';
import { useTimezone } from '../hooks/useTimezone';
import { apiFetch } from '../utils/api';
import { formatDateTimeParts } from '../utils/formatters';

interface ExchangeData {
  count: number;
  ids: string[];
}

interface LogEntry {
  id: number;
  timestamp: string;
  exchanges: Record<string, ExchangeData>;
  offers_count: number;
}

const EXCHANGE_COLOR: Record<string, string> = {
  bisq: '#f7931a',
  hodlhodl: '#4caf82',
  robosats: '#9b59b6',
};

function exchangeColor(name: string) {
  return EXCHANGE_COLOR[name] ?? '#888';
}

export function SnapshotLog() {
  const { timezone } = useTimezone();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // key: `${entryId}:${exchange}`
  const [expandedExchange, setExpandedExchange] = useState<string | null>(null);

  function toggleExchange(key: string) {
    setExpandedExchange(prev => prev === key ? null : key);
  }

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await apiFetch<LogEntry[]>('/api/snapshot-log?limit=20');
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
        const exchangeNames = e.exchanges ? Object.keys(e.exchanges) : [];

        return (
          <div key={e.id} className="border-b border-border last:border-0">
            <button
              onClick={() => setExpanded(isOpen ? null : e.id)}
              className="w-full flex items-center gap-2 text-[0.75rem] py-1 bg-transparent border-none cursor-pointer text-left hover:bg-white/5 rounded px-1 transition-colors"
            >
              <span className="text-muted shrink-0 w-26">{dateStr} {timeStr}</span>
              <div className="flex gap-1 shrink-0">
                {exchangeNames.map(ex => (
                  <span
                    key={ex}
                    title={`${ex}: ${e.exchanges[ex].count}`}
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ background: exchangeColor(ex) }}
                  />
                ))}
              </div>
              <span className="text-text">{e.offers_count} offers</span>
              <span className="ml-auto text-muted">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="flex flex-col gap-0.5 px-1 pb-2 pt-0.5">
                {exchangeNames.map(ex => {
                  const exKey = `${e.id}:${ex}`;
                  const exOpen = expandedExchange === exKey;
                  const ids = e.exchanges[ex].ids;
                  return (
                    <div key={ex}>
                      <button
                        onClick={() => toggleExchange(exKey)}
                        className="w-full flex items-center gap-2 text-[0.72rem] py-0.5 bg-transparent border-none cursor-pointer text-left hover:bg-white/5 rounded px-1 transition-colors"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: exchangeColor(ex) }}
                        />
                        <span className="text-muted w-22 capitalize">{ex}</span>
                        <span className="text-text">{e.exchanges[ex].count} offers</span>
                        <span className="ml-auto text-muted">{exOpen ? '▲' : '▼'}</span>
                      </button>
                      {exOpen && (
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 px-4 pb-1.5 pt-0.5">
                          {ids.map(id => (
                            <span key={id} className="text-[0.65rem] text-muted font-mono">{id}</span>
                          ))}
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
