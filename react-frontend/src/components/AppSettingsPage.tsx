import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAppSettings,
  revealAppSetting,
  updateAppSettings,
  type AppSettingField,
  type AppSettings,
} from '../utils/api';
import { CollapsibleSection } from './accounts/AccountDetailPrimitives';

const MASKED = '***';

const inputCls =
  'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50';
const helpCls = 'mt-0.5 text-[0.7rem] leading-snug text-muted';
const primaryButtonCls =
  'rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

// One unique hue per service. Flat names (green/blue/peach/…) come from the
// project's @theme; multi-word defaults need an explicit shade to be a valid
// utility. Full class strings so Tailwind's JIT keeps them in the build.
const serviceChipCls: Record<string, string> = {
  'mm-controller': 'border-green/40 bg-green/10 text-green',
  'fiat-controller': 'border-peach/40 bg-peach/10 text-peach',
  'unified-api': 'border-blue/40 bg-blue/10 text-blue',
  'unified-snapshot': 'border-indigo-400/40 bg-indigo-400/10 text-indigo-400',
  'dexmonitor': 'border-amber-400/40 bg-amber-400/10 text-amber-400',
  'nginx': 'border-red/40 bg-red/10 text-red',
  'maddy': 'border-teal-400/40 bg-teal-400/10 text-teal-400',
  'grafana': 'border-violet-400/40 bg-violet-400/10 text-violet-400',
  'postgres-backup': 'border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-400',
  'bisq': 'border-cyan-400/40 bg-cyan-400/10 text-cyan-400',
  'bisq2': 'border-lime-400/40 bg-lime-400/10 text-lime-400',
};

function ServiceChip({ service }: { service: string }) {
  return (
    <span
      className={`whitespace-nowrap rounded border px-1.5 py-0 text-xs leading-5 ${serviceChipCls[service] ?? 'border-border bg-bg text-muted'}`}
    >
      {service}
    </span>
  );
}

// parseOwner splits the "a / b" owner string into individual service names.
function parseOwner(owner: string | undefined): string[] {
  if (!owner) return [];
  return owner.split('/').map((part) => part.trim().toLowerCase()).filter(Boolean);
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
  onReveal,
  revealing,
}: {
  field: AppSettingField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onReveal: () => void;
  revealing: boolean;
}) {
  if (field.type === 'bool') {
    const checked = value === 'true';
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={field.label}
        disabled={disabled}
        onClick={() => onChange(checked ? 'false' : 'true')}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    );
  }
  if (field.type === 'enum' && field.enum) {
    return (
      <select
        aria-label={field.label}
        className={inputCls}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {field.enum.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  const inputType = field.type === 'secret' ? 'password' : field.type === 'int' ? 'number' : 'text';
  return (
    <div className="flex items-center gap-1.5">
      <input
        aria-label={field.label}
        type={inputType}
        min={field.type === 'int' ? 0 : undefined}
        className={`${inputCls} font-mono`}
        value={value}
        placeholder={field.default && value === '' ? field.default : undefined}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {field.type === 'secret' ? (
        <button
          type="button"
          className="shrink-0 rounded-md border border-border px-2 py-2 text-xs text-muted transition hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          title="Reveal current value"
          disabled={disabled || revealing}
          onClick={onReveal}
        >
          {revealing ? '…' : 'Reveal'}
        </button>
      ) : null}
    </div>
  );
}

export function AppSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restart, setRestart] = useState<string[]>([]);
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');

  const toggleSection = useCallback((id: string) => {
    setClosedSections((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAppSettings();
      setSettings(data);
      setEdits({});
      setRestart([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const baseValues = useMemo(() => settings?.values ?? {}, [settings]);

  const allFields = useMemo(
    () => settings?.schema.sections.flatMap((section) => section.fields) ?? [],
    [settings],
  );

  const services = useMemo(() => {
    const set = new Set<string>();
    for (const field of allFields) {
      for (const service of parseOwner(field.owner)) set.add(service);
    }
    return [...set].sort();
  }, [allFields]);

  const filteredSections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sections = settings?.schema.sections ?? [];
    return sections
      .map((section) => ({
        ...section,
        fields: section.fields.filter((field) => {
          if (serviceFilter !== 'all' && !parseOwner(field.owner).includes(serviceFilter)) {
            return false;
          }
          if (!needle) return true;
          return (
            field.key.toLowerCase().includes(needle) ||
            field.label.toLowerCase().includes(needle) ||
            (field.description ?? '').toLowerCase().includes(needle) ||
            (field.owner ?? '').toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((section) => section.fields.length > 0);
  }, [settings, query, serviceFilter]);

  const shownCount = useMemo(
    () => filteredSections.reduce((sum, section) => sum + section.fields.length, 0),
    [filteredSections],
  );
  const filtering = query.trim() !== '' || serviceFilter !== 'all';

  const dirtyKeys = useMemo(
    () =>
      Object.entries(edits).filter(([key, value]) => {
        const base = baseValues[key] ?? '';
        if (value === MASKED && base === MASKED) return false;
        return value !== base;
      }).map(([key]) => key),
    [edits, baseValues],
  );

  const handleReveal = useCallback(
    async (field: AppSettingField) => {
      setRevealing(field.key);
      try {
        const revealed = await revealAppSetting(field.key);
        setSettings((prev) =>
          prev ? { ...prev, values: { ...prev.values, [field.key]: revealed.value } } : prev,
        );
        setEdits((prev) => {
          const next = { ...prev };
          delete next[field.key];
          return next;
        });
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : `Failed to reveal ${field.key}`);
      } finally {
        setRevealing(null);
      }
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!settings || dirtyKeys.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, string> = {};
      for (const key of dirtyKeys) payload[key] = edits[key] ?? '';
      const result = await updateAppSettings(payload);
      setSettings((prev) => (prev ? { ...prev, values: result.values } : prev));
      setEdits({});
      setRestart(result.restart);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [settings, dirtyKeys, edits]);

  if (loading) {
    return <div className="p-4 text-sm text-muted">Loading settings…</div>;
  }
  if (error || !settings) {
    return (
      <div className="p-4 text-sm">
        <p className="text-red">Failed to load settings: {error ?? 'unknown error'}</p>
        <button type="button" className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  const readonly = !settings.writable;

  return (
    <div className="flex w-full flex-col gap-3 p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto [&>*]:shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text">Settings</h2>
          <p className="text-xs text-muted">
            User-facing configuration from the root .env. Exchange credentials stay in the Trading Accounts panel.
          </p>
        </div>
        <button
          type="button"
          className={primaryButtonCls}
          disabled={readonly || saving || dirtyKeys.length === 0}
          title={readonly ? 'Settings file not mounted' : `Save ${dirtyKeys.length} change(s)`}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : dirtyKeys.length > 0 ? `Save (${dirtyKeys.length})` : 'Save'}
        </button>
      </div>

      {readonly ? (
        <div className="rounded-md border border-peach/40 bg-peach/10 px-3 py-2 text-xs text-text">
          Read-only: the settings file is not mounted. Showing effective values only. Mount the root .env into
          dexmonitor with <code className="font-mono">SETTINGS_ENV_FILE</code> to enable editing.
        </div>
      ) : null}

      {saveError ? (
        <div className="rounded-md border border-red/40 bg-red/10 px-3 py-2 text-xs text-text">
          {saveError}
        </div>
      ) : null}

      {restart.length > 0 ? (
        <div className="rounded-md border border-blue/40 bg-blue/10 px-3 py-2 text-xs text-text">
          Saved. Recreate to apply:{' '}
          <code className="font-mono">docker compose up -d {restart.join(' ')}</code>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Search settings"
          type="search"
          placeholder="Search by name, key or description…"
          className={`${inputCls} sm:max-w-xs`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Filter by service"
          className={`${inputCls} sm:max-w-[16rem]`}
          value={serviceFilter}
          onChange={(event) => setServiceFilter(event.target.value)}
        >
          <option value="all">All services</option>
          {services.map((service) => (
            <option key={service} value={service}>
              {service}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[0.7rem] text-muted">
          {shownCount} of {allFields.length} shown
        </span>
      </div>

      {filteredSections.length === 0 ? (
        <div className="rounded-md border border-border bg-surface px-3 py-6 text-center text-sm text-muted">
          No settings match the current filters.
        </div>
      ) : null}

      {filteredSections.map((section) => (
        <CollapsibleSection
          key={section.id}
          title={section.title}
          open={filtering ? true : !(closedSections[section.id] ?? false)}
          onToggle={() => toggleSection(section.id)}
        >
          {section.description ? <p className={`${helpCls} mb-3`}>{section.description}</p> : null}
          <div className="flex flex-col divide-y divide-border">
            {section.fields.map((field) => {
              const current = edits[field.key] ?? baseValues[field.key] ?? '';
              const dirty = dirtyKeys.includes(field.key);
              return (
                <div
                  key={field.key}
                  className="grid grid-cols-1 gap-1 py-2.5 first:pt-1 last:pb-0 sm:grid-cols-[minmax(22rem,40%)_1fr] sm:gap-x-6 sm:gap-y-0"
                >
                  <div className="flex flex-col justify-center gap-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <label className="text-xs font-semibold text-text" htmlFor={`setting-${field.key}`}>
                        {field.label}
                        {field.required ? <span className="text-red"> *</span> : null}
                      </label>
                      {dirty ? <span className="text-[0.65rem] font-normal text-peach">● modified</span> : null}
                    </div>
                    <div className="flex items-center gap-x-2">
                      <code className="font-mono text-[0.65rem] text-muted">{field.key}</code>
                      {parseOwner(field.owner).map((service) => (
                        <ServiceChip key={service} service={service} />
                      ))}
                    </div>
                  </div>
                  <div className="flex max-w-3xl flex-col justify-center">
                    <FieldInput
                      field={field}
                      value={current}
                      disabled={readonly || saving}
                      revealing={revealing === field.key}
                      onReveal={() => void handleReveal(field)}
                      onChange={(value) =>
                        setEdits((prev) => ({ ...prev, [field.key]: value }))
                      }
                    />
                    {field.description ? <p className={helpCls}>{field.description}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      ))}
    </div>
  );
}
