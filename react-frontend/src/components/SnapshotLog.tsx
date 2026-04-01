import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';

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

function parseTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  // Already a valid ISO string (has T and/or Z/offset)
  let d = new Date(ts);
  if (!isNaN(d.getTime())) return d;
  // SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS" (UTC, no Z)
  d = new Date(ts.replace(' ', 'T') + 'Z');
  if (!isNaN(d.getTime())) return d;
  // Unix timestamp stored as string
  const n = Number(ts);
  if (!isNaN(n) && n > 0) return new Date(n * 1000);
  return null;
}

export function SnapshotLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  // key: `${entryId}:${exchange}`
  const [expandedExchange, setExpandedExchange] = useState<string | null>(null);

  function toggleExchange(key: string) {
    setExpandedExchange(prev => prev === key ? null : key);
  }

  useEffect(() => {
    apiFetch<LogEntry[]>('/api/snapshot-log?limit=20').then(setEntries).catch(() => {});
    const id = setInterval(() => {
      apiFetch<LogEntry[]>('/api/snapshot-log?limit=20').then(setEntries).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto flex flex-col gap-0.5">
      {entries.length === 0 && (
        <span className="text-muted text-[0.75rem]">No snapshot runs yet.</span>
      )}
      {entries.map(e => {
        const date = parseTimestamp(e.timestamp);
        const timeStr = date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '??:??';
        const dateStr = date ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '???';
        const isOpen = expanded === e.id;
        const exchangeNames = Object.keys(e.exchanges);

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
