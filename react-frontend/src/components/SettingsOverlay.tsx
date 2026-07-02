import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePreferences } from '../hooks/usePreferences';
import { useFilters } from '../hooks/useFilters';
import { useTradeCostConfig } from '../hooks/useTradeCostConfig';
import { ControlPanel } from './ControlPanel';
import type { PaymentMethodGroup } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  groups: PaymentMethodGroup[];
  loadCore: (hours: string, cex?: string, excludedPaymentMethods?: string[], excludedCEXes?: string[], feeTier?: string, coupledHedge?: boolean, maxFiatLimit?: number | null) => void;
  lastUpdatedAt: string;
}

function getOffsetMinutes(timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(new Date());
  const zonePart = parts.find(part => part.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = zonePart.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');
  return sign * (hours * 60 + minutes);
}

function formatUTCCode(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

const PREFERRED_CITY_BY_OFFSET: Record<number, string> = {
  [-720]: 'Baker Island',
  [-660]: 'Honolulu',
  [-600]: 'Anchorage',
  [-570]: 'Marquesas',
  [-540]: 'Los Angeles',
  [-480]: 'Denver',
  [-420]: 'Chicago',
  [-360]: 'New York',
  [-300]: 'Bogota',
  [-240]: 'Santiago',
  [-210]: 'St. John’s',
  [-180]: 'Buenos Aires',
  [-120]: 'South Georgia',
  [-60]: 'Azores',
  [0]: 'London',
  [60]: 'Berlin',
  [120]: 'Athens',
  [180]: 'Moscow',
  [210]: 'Tehran',
  [240]: 'Dubai',
  [270]: 'Kabul',
  [300]: 'Karachi',
  [330]: 'Mumbai',
  [345]: 'Kathmandu',
  [360]: 'Dhaka',
  [390]: 'Yangon',
  [420]: 'Bangkok',
  [480]: 'Singapore',
  [540]: 'Tokyo',
  [570]: 'Darwin',
  [600]: 'Sydney',
  [630]: 'Adelaide',
  [660]: 'Honiara',
  [720]: 'Auckland',
  [765]: 'Chatham Islands',
  [780]: 'Nuku’alofa',
  [840]: 'Kiritimati',
};

const PREFERRED_ZONES_BY_OFFSET: Record<number, string[]> = {
  [-660]: ['Pacific/Honolulu'],
  [-600]: ['America/Anchorage'],
  [-540]: ['America/Los_Angeles'],
  [-480]: ['America/Denver'],
  [-420]: ['America/Chicago'],
  [-360]: ['America/New_York'],
  [-240]: ['America/Santiago'],
  [-210]: ['America/St_Johns'],
  [-180]: ['America/Argentina/Buenos_Aires'],
  [-60]: ['Atlantic/Azores'],
  [0]: ['Europe/London'],
  [60]: ['Europe/Berlin', 'Europe/Paris'],
  [120]: ['Europe/Athens', 'Africa/Cairo'],
  [180]: ['Europe/Moscow'],
  [210]: ['Asia/Tehran'],
  [240]: ['Asia/Dubai'],
  [270]: ['Asia/Kabul'],
  [300]: ['Asia/Karachi'],
  [330]: ['Asia/Kolkata'],
  [345]: ['Asia/Kathmandu'],
  [360]: ['Asia/Dhaka'],
  [390]: ['Asia/Yangon'],
  [420]: ['Asia/Bangkok'],
  [480]: ['Asia/Singapore'],
  [540]: ['Asia/Tokyo'],
  [570]: ['Australia/Darwin'],
  [600]: ['Australia/Sydney'],
  [630]: ['Australia/Adelaide'],
  [660]: ['Pacific/Guadalcanal'],
  [720]: ['Pacific/Auckland'],
  [765]: ['Pacific/Chatham'],
  [780]: ['Pacific/Tongatapu'],
  [840]: ['Pacific/Kiritimati'],
};

function cityFromTimezoneName(timezone: string): string {
  const tail = timezone.split('/').pop() ?? timezone;
  return tail.replaceAll('_', ' ');
}

function getAllTimezonesSorted(): { value: string; label: string; offsetMinutes: number }[] {
  const supported = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [];

  const unique = Array.from(new Set(['UTC', ...supported])).sort((a, b) => a.localeCompare(b));
  const zones = unique.map(zone => {
    const offsetMinutes = getOffsetMinutes(zone);
    return {
      value: zone,
      offsetMinutes,
      label: `${formatUTCCode(offsetMinutes)} - ${cityFromTimezoneName(zone)}`,
    };
  });

  const byOffset = new Map<number, { value: string; label: string; offsetMinutes: number }[]>();
  for (const zone of zones) {
    const list = byOffset.get(zone.offsetMinutes) ?? [];
    list.push(zone);
    byOffset.set(zone.offsetMinutes, list);
  }

  const deduped = Array.from(byOffset.entries()).map(([offsetMinutes, list]) => {
    const preferredZones = PREFERRED_ZONES_BY_OFFSET[offsetMinutes] ?? [];
    const picked = preferredZones
      .map(pref => list.find(item => item.value === pref))
      .find(Boolean) ?? list[0];
    const city = PREFERRED_CITY_BY_OFFSET[offsetMinutes] ?? cityFromTimezoneName(picked.value);

    return {
      value: picked.value,
      offsetMinutes,
      label: `${formatUTCCode(offsetMinutes)} - ${city}`,
    };
  });

  deduped.sort((a, b) => {
    if (a.offsetMinutes !== b.offsetMinutes) return a.offsetMinutes - b.offsetMinutes;
    return a.value.localeCompare(b.value);
  });

  return deduped;
}

const allTimezones = getAllTimezonesSorted();


export function SettingsOverlay({
  open,
  onClose,
  groups,
  loadCore,
  lastUpdatedAt,
}: Props) {
  const {
    preferredTimezone,
    setPreferredTimezone,
    excludedMethods,
    toggleMethod,
    toggleGroup,
    excludedCEXes,
    toggleCEX,
    feeTier,
    setFeeTier,
    coupledHedge,
    setCoupledHedge,
    maxFiatLimit,
    setMaxFiatLimit,
    hideZeroTrustScore,
    setHideZeroTrustScore,
  } = usePreferences();
  const { filters, zeroTrustHiddenCount, paymentMethodCounts } = useFilters();
  const { config: tradeCostConfig } = useTradeCostConfig(open);
  const excludedSet = new Set(excludedMethods);
  const excludedCEXSet = new Set(excludedCEXes);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());

  const toggleCollapse = (name: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end sm:items-start justify-center sm:justify-end sm:p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] cursor-default"
        onClick={onClose}
        aria-label="Close settings"
      />

      <aside className="relative z-10 w-full sm:max-w-md lg:max-w-[50vw] rounded-t-xl sm:rounded-xl border border-border bg-surface/95 shadow-2xl shadow-black/30 flex flex-col max-h-[90dvh] animate-[settings-slide_220ms_ease-out]">
        {/* Fixed header */}
        <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <p className="text-[0.6rem] uppercase tracking-wide text-muted">Interface Preferences</p>
            <h2 className="text-xs font-semibold text-text">Settings</h2>
          </div>
          <button
            type="button"
            className="px-2 py-0.5 text-xs border border-border rounded-md text-muted hover:text-text hover:border-muted"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-2.5">
          <section className="rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="mb-2">
              <h3 className="text-xs font-medium">Monitor Filters</h3>
              <p className="mt-0.5 text-[0.65rem] text-muted leading-tight">Filters and timeframe for the live offers view.</p>
            </div>
            <ControlPanel
              onRefresh={() => loadCore(filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit)}
              lastUpdatedAt={lastUpdatedAt}
            />
          </section>

          <section className="rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="mb-1.5 lg:flex lg:items-baseline lg:gap-3">
              <div className="shrink-0">
                <h3 className="text-xs font-medium">Preferred Timezone</h3>
              </div>
              <p className="mt-0.5 lg:mt-0 lg:ml-auto lg:text-right text-[0.65rem] text-muted leading-tight">This controls how timestamps are displayed across dashboard panels.</p>
            </div>
            <select
              value={preferredTimezone}
              onChange={event => setPreferredTimezone(event.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
            >
              {allTimezones.map(tz => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </section>

          <section className="rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="mb-2 lg:flex lg:items-baseline lg:gap-3">
              <div className="shrink-0">
                <h3 className="text-xs font-medium">Payment Methods</h3>
              </div>
              <p className="mt-0.5 lg:mt-0 lg:ml-auto lg:text-right text-[0.65rem] text-muted leading-tight">Disabled methods are hidden from all views and excluded from API queries.</p>
            </div>

            {groups.length === 0 ? (
              <p className="text-[0.65rem] text-muted">Loading payment methods…</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {groups.map(group => {
                  const allExcluded = group.methods.every(m => excludedSet.has(m));
                  const someExcluded = group.methods.some(m => excludedSet.has(m));
                  const collapsed = !expandedGroups.has(group.name);
                  return (
                    <div key={group.name} className="rounded-md border border-border overflow-hidden">
                      {/* Group header row — click left side to collapse, right button to toggle */}
                      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 ${allExcluded ? 'bg-bg/80' : 'bg-bg/30'}`}>
                        <button
                          type="button"
                          onClick={() => toggleCollapse(group.name)}
                          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                        >
                          <span className={`text-[0.55rem] text-muted transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}>▶</span>
                          <span className={`text-[0.7rem] font-semibold ${allExcluded ? 'text-muted line-through' : 'text-text'}`}>
                            {group.display_name}
                          </span>
                          <span className="text-[0.55rem] text-muted tabular-nums">
                            {group.methods.reduce((sum, m) => sum + (paymentMethodCounts[m] ?? 0), 0)}
                          </span>
                          {someExcluded && !allExcluded && (
                            <span className="text-[0.5rem] uppercase tracking-wide text-accent border border-accent/40 rounded px-0.5 py-px">partial</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.methods, !allExcluded)}
                          className={`shrink-0 text-[0.65rem] px-2 py-0.5 rounded-md border font-medium transition-colors ${
                            allExcluded
                              ? 'border-green/50 text-green hover:bg-green/10'
                              : 'border-red/50 text-red hover:bg-red/10'
                          }`}
                        >
                          {allExcluded ? 'Enable all' : 'Disable all'}
                        </button>
                      </div>

                      {/* Individual methods — hidden when collapsed */}
                      {!collapsed && (
                      <div className="divide-y divide-border/50">
                        {group.methods.map(method => {
                          const excluded = excludedSet.has(method);
                          return (
                            <div key={method} className={`flex items-center justify-between gap-1.5 px-2.5 py-1 pl-4 ${excluded ? 'opacity-50' : ''}`}>
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <span className={`text-[0.65rem] truncate ${excluded ? 'text-muted line-through' : 'text-text'}`}>{method}</span>
                                <span className="text-[0.55rem] text-muted tabular-nums shrink-0">{paymentMethodCounts[method] ?? 0}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleMethod(method)}
                                className={`text-[0.6rem] px-1.5 py-0.5 rounded border font-medium transition-colors ${
                                  excluded
                                    ? 'border-green/40 text-green hover:bg-green/10'
                                    : 'border-border text-muted hover:border-red/50 hover:text-red'
                                }`}
                              >
                                {excluded ? 'Enable' : 'Disable'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-xs font-medium">Seller Trust Score</h3>
                <p className="mt-0.5 text-[0.65rem] text-muted leading-tight">
                  Hide score-0 makers from the current monitor view (respects premium, direction, and other active filters). Offers with no rating signal are unaffected.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHideZeroTrustScore(!hideZeroTrustScore)}
                className={`shrink-0 text-[0.65rem] px-2 py-0.5 rounded-md border font-medium transition-colors ${
                  hideZeroTrustScore
                    ? 'border-accent/60 text-accent bg-accent/10'
                    : 'border-border text-muted hover:border-muted'
                }`}
              >
                {hideZeroTrustScore
                  ? `Hiding ${zeroTrustHiddenCount}`
                  : zeroTrustHiddenCount > 0
                    ? `Show all (${zeroTrustHiddenCount} score 0)`
                    : 'Show all'}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="mb-2 lg:flex lg:items-baseline lg:gap-3">
              <div className="shrink-0">
                <h3 className="text-xs font-medium">CEX Exchanges</h3>
              </div>
              <p className="mt-0.5 lg:mt-0 lg:ml-auto lg:text-right text-[0.65rem] text-muted leading-tight">Disabled exchanges are excluded from the best-route cost calculation.</p>
            </div>

            {tradeCostConfig.cexes.length === 0 ? (
              <p className="text-[0.65rem] text-muted">Loading exchanges…</p>
            ) : (
              <div className="flex flex-col gap-1">
                {tradeCostConfig.cexes.map(cex => {
                  const excluded = excludedCEXSet.has(cex.name);
                  const label = cex.name.charAt(0).toUpperCase() + cex.name.slice(1);
                  return (
                    <div key={cex.name} className={`flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-md border border-border ${excluded ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`text-[0.7rem] font-semibold ${excluded ? 'text-muted line-through' : 'text-text'}`}>{label}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCEX(cex.name)}
                        className={`text-[0.6rem] px-1.5 py-0.5 rounded border font-medium transition-colors ${
                          excluded
                            ? 'border-green/40 text-green hover:bg-green/10'
                            : 'border-border text-muted hover:border-red/50 hover:text-red'
                        }`}
                      >
                        {excluded ? 'Enable' : 'Disable'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="mb-1.5 lg:flex lg:items-baseline lg:gap-3">
              <div className="shrink-0">
                <h3 className="text-xs font-medium">BTC Network Fee Tier</h3>
              </div>
              <p className="mt-0.5 lg:mt-0 lg:ml-auto lg:text-right text-[0.65rem] text-muted leading-tight">
                Auto selects the optimal tier based on mempool congestion. Override to lock a specific fee speed.
              </p>
            </div>
            <select
              value={feeTier}
              onChange={event => setFeeTier(event.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
            >
              {tradeCostConfig.fee_tiers.map(tier => (
                <option key={tier.value} value={tier.value}>
                  {tier.label}
                </option>
              ))}
            </select>
          </section>

          <section className="rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-xs font-medium">CEX Spot Trade &amp; Hedge</h3>
                <p className="mt-0.5 text-[0.65rem] text-muted leading-tight">
                  When enabled, the perp hedge venue is locked to the same exchange as the spot CEX (Kraken&nbsp;→&nbsp;Kraken Futures, Coinbase&nbsp;→&nbsp;Coinbase Futures). Exchanges without a paired perp fall back to the cheapest available.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCoupledHedge(!coupledHedge)}
                className={`shrink-0 text-[0.65rem] px-2 py-0.5 rounded-md border font-medium transition-colors ${
                  coupledHedge
                    ? 'border-accent/60 text-accent bg-accent/10'
                    : 'border-border text-muted hover:border-muted'
                }`}
              >
                {coupledHedge ? 'Coupled' : 'Independent'}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="mb-1.5 lg:flex lg:items-baseline lg:gap-3">
              <div className="shrink-0">
                <h3 className="text-xs font-medium">Max Position Size (Fiat)</h3>
              </div>
              <p className="mt-0.5 lg:mt-0 lg:ml-auto lg:text-right text-[0.65rem] text-muted leading-tight">
                Cap profit calculations to this EUR amount. Larger orders will show both the full-size and the capped result.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">€</span>
              <input
                type="number"
                min={0}
                step={50}
                placeholder="No limit"
                value={maxFiatLimit ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  setMaxFiatLimit(v === '' ? null : Math.max(0, Number(v)));
                }}
                className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent mono-nums"
              />
              {maxFiatLimit != null && (
                <button
                  type="button"
                  onClick={() => setMaxFiatLimit(null)}
                  className="text-[0.65rem] px-2 py-0.5 rounded-md border border-border text-muted hover:border-red/50 hover:text-red transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>,
    document.body
  );
}
