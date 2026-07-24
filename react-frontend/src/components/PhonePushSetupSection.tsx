import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  fetchPhonePushSetup,
  revealPhonePushSecrets,
  type PhonePushSecrets,
  type PhonePushSetup,
} from '../utils/api';

type AutomationApp = 'MacroDroid' | 'Tasker';

const notifyBody = '{"app":"<bank-app>","title":"<notification-title>","text":"<notification-text>","time":"<optional-ISO-8601>"}';
const heartbeatBody = '{"device_id":"<stable-phone-name>"}';

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current stroke-[1.7]">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" />
      <path d="M9.5 5h5M10.5 18.5h3" />
      <path d="M9 9.5h6v5H9z" className="opacity-60" />
    </svg>
  );
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="shrink-0 rounded-md border border-blue/25 bg-blue/5 px-2 py-1 text-[0.6rem] font-medium text-blue transition hover:border-blue/50 hover:bg-blue/10"
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="relative grid grid-cols-[1.7rem_1fr] gap-2.5 pb-4 last:pb-0">
      <span className="absolute left-[0.82rem] top-6 h-[calc(100%-1rem)] w-px bg-blue/20 last:hidden" />
      <span className="relative z-10 flex size-7 items-center justify-center rounded-full border border-blue/35 bg-blue/10 text-[0.65rem] font-semibold text-blue">
        {number}
      </span>
      <div className="pt-0.5">
        <p className="text-[0.72rem] font-medium text-text">{title}</p>
        <div className="mt-0.5 text-[0.65rem] leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  );
}

function InlineValue({ children, copyValue }: { children: ReactNode; copyValue: string }) {
  return (
    <span className="mt-1.5 flex min-w-0 items-center gap-2 rounded-md border border-border/80 bg-bg/70 px-2 py-1.5">
      <code className="min-w-0 flex-1 truncate text-[0.61rem] text-text">{children}</code>
      <CopyButton value={copyValue} />
    </span>
  );
}

function SetupGuide({ app, setup }: { app: AutomationApp; setup: PhonePushSetup }) {
  const macro = app === 'MacroDroid';

  return (
    <ol className="mt-4">
      <Step number={1} title="Give notification access">
        Allow {app} to read notifications, exclude it from battery optimisation, and permit background data.
      </Step>
      <Step number={2} title={macro ? 'Create a Notification Received trigger' : 'Create a notification profile'}>
        {macro
          ? 'Filter the trigger to the banking apps you trust. Use MacroDroid notification magic text for app, title, and text.'
          : 'Choose the banking apps in Tasker’s Notification event, then attach a new task to that profile.'}
      </Step>
      <Step number={3} title="Forward matching notifications">
        Add an HTTP Request action using POST and the revealed notification secret.
        <InlineValue copyValue={setup.notify_url}>{setup.notify_url}</InlineValue>
      </Step>
      <Step number={4} title="Keep the phone online">
        Create a separate five-minute timer that POSTs the heartbeat payload. Run it once from the physical phone.
        <InlineValue copyValue={setup.heartbeat_url}>{setup.heartbeat_url}</InlineValue>
      </Step>
    </ol>
  );
}

function SecretRow({
  label,
  configured,
  value,
  note,
}: {
  label: string;
  configured: boolean;
  value?: string;
  note?: string;
}) {
  const displayed = value || (configured ? '••••••••••••••••••••••••' : 'Not configured');

  return (
    <div className="grid gap-1 border-b border-border/70 py-2.5 last:border-0 sm:grid-cols-[9.5rem_1fr_auto] sm:items-center">
      <span className="text-[0.62rem] font-medium text-muted">{label}</span>
      <div className="min-w-0">
        <code className={`block truncate text-[0.63rem] ${configured ? 'text-text' : 'text-amber-600'}`}>{displayed}</code>
        {note ? <span className="text-[0.58rem] text-muted">{note}</span> : null}
      </div>
      {value ? <CopyButton value={value} label="Copy secret" /> : null}
    </div>
  );
}

function TechnicalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-border/70 py-2 last:border-0 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
      <span className="text-[0.6rem] font-medium uppercase tracking-wide text-muted">{label}</span>
      <code className="min-w-0 break-all text-[0.61rem] text-text">{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

export function PhonePushSetupSection() {
  const [setup, setSetup] = useState<PhonePushSetup | null>(null);
  const [secrets, setSecrets] = useState<PhonePushSecrets | null>(null);
  const [activeApp, setActiveApp] = useState<AutomationApp>('MacroDroid');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError('');
    try {
      setSetup(await fetchPhonePushSetup());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function reveal() {
    setBusy(true);
    setError('');
    try {
      setSecrets(await revealPhonePushSecrets());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const qr = useMemo(() => {
    if (!setup) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=svg&data=${encodeURIComponent(JSON.stringify({
      format: 'dexarb-phone-push',
      version: 1,
      header: 'X-Webhook-Secret',
      secret: 'Copy the revealed credentials separately; this QR contains no credential.',
      workflows: [
        {
          name: 'bank-notification',
          endpoint: setup.notify_url,
          method: 'POST',
          body: notifyBody,
          trigger: 'Selected banking-app notification',
        },
        {
          name: 'phone-heartbeat',
          endpoint: setup.heartbeat_url,
          method: 'POST',
          body: heartbeatBody,
          interval_minutes: 5,
        },
      ],
    }))}`;
  }, [setup]);

  const lastSeen = setup?.last_seen ? new Date(setup.last_seen).toLocaleString() : 'No check-in yet';

  return (
    <section className="h-fit overflow-hidden rounded-xl border border-blue/30 bg-surface shadow-[0_12px_32px_rgba(0,0,0,0.08)]">
      <header className="relative overflow-hidden border-b border-blue/20 bg-linear-to-r from-blue/15 via-blue/7 to-transparent px-4 py-3.5">
        <div className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full bg-blue/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue text-white shadow-sm">
              <PhoneIcon />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text">Phone payment monitoring</h3>
                <span className="rounded-full border border-blue/25 bg-blue/10 px-1.5 py-0.5 text-[0.52rem] font-semibold uppercase tracking-wider text-blue">
                  Android
                </span>
              </div>
              <p className="mt-0.5 text-[0.65rem] text-muted">Turn selected banking notifications into verified payment signals.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {setup ? (
              <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.62rem] font-medium ${
                setup.online
                  ? 'border-green/30 bg-green/10 text-green'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
              }`}>
                <span className={`size-1.5 rounded-full ${setup.online ? 'bg-green shadow-[0_0_0_3px_rgba(63,185,80,0.15)]' : 'bg-amber-500'}`} />
                {setup.online ? 'Phone online' : 'Awaiting phone'}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="rounded-md border border-border/80 bg-surface/70 px-2.5 py-1 text-[0.62rem] text-muted transition hover:border-blue/40 hover:text-blue disabled:opacity-50"
            >
              {busy ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <div className="p-4">
        {error ? <p className="mb-3 rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-[0.65rem] text-red">{error}</p> : null}

        {!setup ? (
          <div className="grid min-h-36 place-items-center text-xs text-muted">{busy ? 'Loading phone setup…' : 'Phone setup is unavailable.'}</div>
        ) : (
          <>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-bg/45 px-3 py-2.5">
                <span className="text-[0.56rem] font-semibold uppercase tracking-wider text-muted">Connection</span>
                <p className={`mt-1 text-[0.72rem] font-medium ${setup.online ? 'text-green' : 'text-text'}`}>
                  {setup.online ? setup.device_id || 'Connected phone' : 'Not connected'}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-bg/45 px-3 py-2.5">
                <span className="text-[0.56rem] font-semibold uppercase tracking-wider text-muted">Last heartbeat</span>
                <p className="mt-1 truncate text-[0.68rem] font-medium text-text">{lastSeen}</p>
              </div>
              <div className="rounded-lg border border-border/70 bg-bg/45 px-3 py-2.5">
                <span className="text-[0.56rem] font-semibold uppercase tracking-wider text-muted">Offline after</span>
                <p className="mt-1 text-[0.72rem] font-medium text-text">{Math.round(setup.max_age_seconds / 60)} minutes</p>
              </div>
            </div>

            {setup.heartbeat_status_error ? (
              <p className="mt-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[0.63rem] text-amber-600">
                {setup.heartbeat_status_error}
              </p>
            ) : null}

            <div className="mt-5 grid gap-5">
              <div className="min-w-0">
                <div className="flex items-end justify-between gap-3 border-b border-border">
                  <div>
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-blue">Setup guide</p>
                    <p className="mt-0.5 text-[0.68rem] text-muted">Choose the automation app installed on your phone.</p>
                  </div>
                  <div className="flex rounded-t-lg border border-b-0 border-border bg-bg p-0.5">
                    {(['MacroDroid', 'Tasker'] as AutomationApp[]).map(app => (
                      <button
                        key={app}
                        type="button"
                        onClick={() => setActiveApp(app)}
                        className={`rounded-md px-3 py-1.5 text-[0.65rem] font-medium transition ${
                          activeApp === app ? 'bg-blue/12 text-blue shadow-sm' : 'text-muted hover:text-text'
                        }`}
                      >
                        {app}
                      </button>
                    ))}
                  </div>
                </div>
                <SetupGuide app={activeApp} setup={setup} />
              </div>

              <aside className="w-full rounded-xl border border-blue/20 bg-blue/5 p-3">
                <div className="grid items-center gap-4 sm:grid-cols-[13.75rem_1fr]">
                  <div className="overflow-hidden rounded-lg border border-white/80 bg-white p-2 shadow-sm">
                  <img
                    src={qr}
                    width="220"
                    height="220"
                    alt="Non-secret combined phone monitoring setup reference QR code"
                    className="mx-auto aspect-square w-full"
                  />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.64rem] font-semibold text-text">Transfer both workflows</p>
                      <span className="rounded bg-blue/10 px-1.5 py-0.5 text-[0.46rem] font-semibold uppercase tracking-wider text-blue">Reference QR</span>
                    </div>
                    <p className="mt-1.5 text-[0.55rem] leading-relaxed text-muted">
                      Scanning opens one text bundle containing both callback URLs, the POST method, header name, JSON templates and five-minute heartbeat interval.
                    </p>
                    <p className="mt-2 text-[0.55rem] leading-relaxed text-muted">
                      It does not configure MacroDroid or Tasker automatically. Follow the guide to create the trigger, HTTP actions, banking-app filter and timer, then add the revealed secret separately.
                    </p>
                    <p className="mt-2 text-[0.52rem] font-medium text-blue">No credentials are stored in this code.</p>
                  </div>
                </div>
              </aside>
            </div>

            <details className="group mt-5 rounded-lg border border-border/80 bg-bg/35">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[0.68rem] font-medium text-text">
                <span>
                  Connection details
                  <span className="ml-2 font-normal text-muted">Credentials, headers and payload templates</span>
                </span>
                <span className="text-muted transition group-open:rotate-180">⌄</span>
              </summary>
              <div className="border-t border-border px-3 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <p className="text-[0.62rem] text-muted">
                    Secrets are deployment-managed and shown only after an explicit reveal.
                  </p>
                  {!secrets ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void reveal()}
                      className="rounded-md bg-blue px-2.5 py-1.5 text-[0.62rem] font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
                    >
                      Reveal credentials
                    </button>
                  ) : null}
                </div>
                <div className="rounded-lg border border-border/70 bg-surface px-3">
                  <SecretRow
                    label="Notification secret"
                    configured={setup.notify_credential_configured}
                    value={secrets?.notify_secret}
                  />
                  <SecretRow
                    label="Heartbeat secret"
                    configured={setup.heartbeat_credential_configured}
                    value={secrets?.heartbeat_secret}
                    note={setup.heartbeat_uses_notify_credential ? 'Uses the notification credential' : undefined}
                  />
                </div>
                <div className="mt-3 rounded-lg border border-border/70 bg-surface px-3">
                  <TechnicalRow label="Method" value="POST" />
                  <TechnicalRow label="Header" value="X-Webhook-Secret" />
                  <TechnicalRow label="Notification JSON" value={notifyBody} />
                  <TechnicalRow label="Heartbeat JSON" value={heartbeatBody} />
                </div>
              </div>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
