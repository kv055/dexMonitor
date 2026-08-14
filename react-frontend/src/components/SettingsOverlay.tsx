import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePreferences } from '../hooks/usePreferences';
import { useFilters } from '../hooks/useFilters';
import { useCEXPermissions } from '../hooks/useCEXPermissions';
import { fiatSymbol } from '../utils/currency';
import type { PaymentMethodGroup } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  groups: PaymentMethodGroup[];
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
}: Props) {
  const {
    preferredTimezone,
    setPreferredTimezone,
    excludedMethods,
    toggleMethod,
    toggleGroup,
    maxFiatLimit,
    setMaxFiatLimit,
    hideZeroTrustScore,
    setHideZeroTrustScore,
  } = usePreferences();
  const { zeroTrustHiddenCount, paymentMethodCounts, filters } = useFilters();
  const {
    exchanges,
    loading: cexPermissionsLoading,
    error: cexPermissionsError,
    updating: cexPolicyUpdating,
    updatePolicy,
    reload: reloadCEXPermissions,
  } = useCEXPermissions();
  const excludedSet = new Set(excludedMethods);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [expandedCEXes, setExpandedCEXes] = useState<Set<string>>(() => new Set());

  const toggleCollapse = (name: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleCEXCollapse = (exchange: string) =>
    setExpandedCEXes(prev => {
      const next = new Set(prev);
      if (next.has(exchange)) next.delete(exchange);
      else next.add(exchange);
      return next;
    });

  useEffect(() => {
    if (!open) return;
    reloadCEXPermissions();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, reloadCEXPermissions]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end sm:items-start justify-center sm:justify-end sm:p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] cursor-default"
        role="button"
        tabIndex={0}
        onClick={onClose}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClose();
          }
        }}
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
              <p className="mt-0.5 lg:mt-0 lg:ml-auto lg:text-right text-[0.65rem] text-muted leading-tight">Spot and hedge venues can be enabled independently. Permission-locked controls stay disabled.</p>
            </div>

            {cexPermissionsLoading ? (
              <p className="text-[0.65rem] text-muted">Loading exchanges…</p>
            ) : cexPermissionsError ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.65rem] text-red">Could not load exchange permissions: {cexPermissionsError}</p>
                <button type="button" onClick={reloadCEXPermissions} className="text-[0.6rem] px-1.5 py-0.5 rounded border border-border text-muted hover:text-text">
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {exchanges.filter(cex => cex.cost_supported).map(cex => {
                  const spotEnabled = cex.policy.spot_enabled;
                  const hedgeEnabled = cex.policy.hedge_enabled;
                  const spotLocked = !cex.spot.supported || !cex.spot.available;
                  const hedgeLocked = !cex.hedge.supported || !cex.hedge.available;
                  const spotDisabled = !cex.spot.effective_enabled;
                  const hedgeDisabled = !cex.hedge.effective_enabled;
                  const allDisabled = spotDisabled && hedgeDisabled;
                  const policyAllDisabled = !spotEnabled && !hedgeEnabled;
                  const someDisabled = spotDisabled || hedgeDisabled;
                  const collapsed = !expandedCEXes.has(cex.exchange);
                  const reason = (kind: 'spot' | 'hedge') => {
                    const availability = cex[kind];
                    return availability.blockers.map(blocker => blocker.message).join(' ') || 'Capability unavailable.';
                  };
                  const savePolicy = (spot: boolean, hedge: boolean) => {
                    void updatePolicy(cex.exchange, { spot_enabled: spot, hedge_enabled: hedge });
                  };
                  const toggleWholeCEX = () => {
                    const enable = !spotEnabled && !hedgeEnabled;
                    savePolicy(
                      cex.spot.supported ? enable : spotEnabled,
                      cex.hedge.supported ? enable : hedgeEnabled,
                    );
                  };
                  return (
                    <div key={cex.exchange} className="rounded-md border border-border overflow-hidden">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 ${allDisabled ? 'bg-bg/80' : 'bg-bg/30'}`}>
                        <button
                          type="button"
                          onClick={() => toggleCEXCollapse(cex.exchange)}
                          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                          aria-expanded={!collapsed}
                        >
                          <span className={`text-[0.55rem] text-muted transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}>▶</span>
                          <span className={`text-[0.7rem] font-semibold ${allDisabled ? 'text-muted line-through' : 'text-text'}`}>{cex.provider}</span>
                          <span className="text-[0.55rem] text-muted">{cex.active_key_count} active key{cex.active_key_count === 1 ? '' : 's'}</span>
                          {someDisabled && !allDisabled && <span className="text-[0.5rem] uppercase tracking-wide text-accent border border-accent/40 rounded px-0.5 py-px">partial</span>}
                        </button>
                        <button
                          type="button"
                          onClick={toggleWholeCEX}
                          disabled={cexPolicyUpdating === cex.exchange || (!cex.spot.supported && !cex.hedge.supported)}
                          className={`shrink-0 text-[0.65rem] px-2 py-0.5 rounded-md border font-medium transition-colors ${
                            !cex.spot.supported && !cex.hedge.supported
                              ? 'cursor-not-allowed border-border text-muted opacity-45'
                              : policyAllDisabled
                                ? 'border-green/50 text-green hover:bg-green/10'
                                : 'border-red/50 text-red hover:bg-red/10'
                          }`}
                        >
                          {!cex.spot.supported && !cex.hedge.supported ? 'Unsupported' : !spotEnabled && !hedgeEnabled ? 'Enable CEX' : 'Disable CEX'}
                        </button>
                      </div>

                      {!collapsed && (
                      <div className="divide-y divide-border/50">
                        {([
                          ['Spot', spotEnabled, spotLocked, () => savePolicy(!spotEnabled, hedgeEnabled), reason('spot')],
                          ['Hedge (Futures)', hedgeEnabled, hedgeLocked, () => savePolicy(spotEnabled, !hedgeEnabled), reason('hedge')],
                        ] as const).map(([label, enabled, locked, toggle, lockedReason]) => (
                          <div key={label} className="px-2.5 py-1 pl-4">
                            <div className="flex items-center justify-between gap-1">
                              <span className={`text-[0.6rem] font-medium ${locked ? 'opacity-45' : ''}`}>{label}</span>
                              <button
                                type="button"
                                disabled={locked || cexPolicyUpdating === cex.exchange}
                                onClick={toggle}
                                className={`text-[0.55rem] px-1.5 py-0.5 rounded border font-medium ${locked ? 'opacity-45 ' : ''}${
                                  locked
                                    ? 'cursor-not-allowed border-border text-muted'
                                    : !enabled
                                      ? 'border-green/40 text-green hover:bg-green/10'
                                      : 'border-accent/40 text-accent hover:bg-accent/10'
                                }`}
                              >
                                {locked ? 'Locked' : enabled ? 'Enabled' : 'Enable'}
                              </button>
                            </div>
                            {locked && <p className="mt-1 text-[0.55rem] leading-tight text-muted">{lockedReason}</p>}
                          </div>
                        ))}
                      </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="mb-1.5 lg:flex lg:items-baseline lg:gap-3">
              <div className="shrink-0">
                <h3 className="text-xs font-medium">Max Position Size (Fiat)</h3>
              </div>
              <p className="mt-0.5 lg:mt-0 lg:ml-auto lg:text-right text-[0.65rem] text-muted leading-tight">
                Cap profit calculations to this {filters.fiat} amount. Larger orders will show both the full-size and the capped result.
              </p>
            </div>
            <div className="flex items-center gap-2">
			  <span className="text-xs text-muted">{fiatSymbol(filters.fiat)}</span>
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
