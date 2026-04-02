import { useEffect } from 'react';
import { createPortal } from 'react-dom';

type PaymentMethodMode = 'neutral' | 'include' | 'exclude';

interface Props {
  open: boolean;
  onClose: () => void;
  preferredTimezone: string;
  onTimezoneChange: (timezone: string) => void;
  paymentMethodModes: Record<string, PaymentMethodMode>;
  onPaymentMethodModeChange: (method: string, mode: PaymentMethodMode) => void;
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

const modeButtonClass = (active: boolean) =>
  `px-2 py-1 rounded-md border text-xs font-medium transition-colors ${
    active
      ? 'bg-bg border-accent text-text'
      : 'bg-transparent border-border text-muted hover:text-text hover:border-muted'
  }`;

export function SettingsOverlay({
  open,
  onClose,
  preferredTimezone,
  onTimezoneChange,
  paymentMethodModes,
  onPaymentMethodModeChange,
}: Props) {
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
    <div className="fixed inset-0 z-40 flex items-start justify-end p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] cursor-default"
        onClick={onClose}
        aria-label="Close settings"
      />

      <aside className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface/95 shadow-2xl shadow-black/30 overflow-hidden animate-[settings-slide_220ms_ease-out]">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-[0.7rem] uppercase tracking-wide text-muted">Interface Preferences</p>
            <h2 className="text-sm font-semibold text-text">Settings</h2>
          </div>
          <button
            type="button"
            className="px-2 py-0.5 text-sm border border-border rounded-md text-muted hover:text-text hover:border-muted"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div className="rounded-md border border-red bg-error px-3 py-2 text-sm text-red font-semibold">
            Preview only: this settings panel is currently a dummy mockup.
          </div>

          <section className="rounded-lg border border-border bg-bg/50 p-3">
            <div className="mb-2">
              <p className="text-[0.7rem] uppercase tracking-wide text-muted">Timezone</p>
              <h3 className="text-sm font-medium">Preferred Timezone</h3>
            </div>
            <select
              value={preferredTimezone}
              onChange={event => onTimezoneChange(event.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2 py-2 text-sm text-text outline-none focus:border-accent"
            >
              {allTimezones.map(tz => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted">This controls how timestamps are displayed across dashboard panels.</p>
          </section>

          <section className="rounded-lg border border-border bg-bg/50 p-3">
            <div className="mb-2">
              <p className="text-[0.7rem] uppercase tracking-wide text-muted">Payment Methods</p>
              <h3 className="text-sm font-medium">Include or Exclude</h3>
            </div>

            <div className="space-y-2">
              {Object.entries(paymentMethodModes).map(([method, mode]) => (
                <div key={method} className="rounded-md border border-border px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text">{method}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={modeButtonClass(mode === 'neutral')}
                        onClick={() => onPaymentMethodModeChange(method, 'neutral')}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className={modeButtonClass(mode === 'include')}
                        onClick={() => onPaymentMethodModeChange(method, 'include')}
                      >
                        Include
                      </button>
                      <button
                        type="button"
                        className={modeButtonClass(mode === 'exclude')}
                        onClick={() => onPaymentMethodModeChange(method, 'exclude')}
                      >
                        Exclude
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>,
    document.body
  );
}
