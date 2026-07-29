import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  fetchPhonePushSetup,
  revealPhonePushSecrets,
  type PhonePushSecrets,
  type PhonePushSetup,
} from '../utils/api';
import { LocalQrCode } from './LocalQrCode';

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

function SetupGuide({
  setup,
  secrets,
  busy,
  onReveal,
}: {
  setup: PhonePushSetup;
  secrets: PhonePushSecrets | null;
  busy: boolean;
  onReveal: () => void;
}) {
  return (
    <ol className="mt-4">
      <Step number={1} title="Give notification access">
        Allow MacroDroid to read notifications, exclude it from battery optimisation, and permit background data.
      </Step>
      <Step number={2} title="Create a Notification Received trigger">
        Filter the trigger to the banking apps you trust. Use MacroDroid notification Magic Text for app, title, and text.
      </Step>
      <Step number={3} title="Reveal request-header secrets">
        Add the shared value below as the `X-Webhook-Secret` header parameter in each HTTP Request action.
        {!secrets ? (
          <button
            type="button"
            disabled={busy}
            onClick={onReveal}
            className="mt-2 rounded-md bg-blue px-2.5 py-1.5 text-[0.62rem] font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            Reveal header secrets
          </button>
        ) : (
          <div className="mt-2 space-y-2">
            <div>
              <p className="text-[0.58rem] font-medium text-muted">Shared callback header value</p>
              <InlineValue copyValue={secrets.shared_secret}>{secrets.shared_secret}</InlineValue>
            </div>
          </div>
        )}
      </Step>
      <Step number={4} title="Forward matching notifications">
        Add an HTTP Request action using POST and the shared header secret above.
        <InlineValue copyValue={setup.notify_url}>{setup.notify_url}</InlineValue>
      </Step>
      <Step number={5} title="Keep the phone online">
        Create a separate five-minute timer that POSTs the heartbeat payload with the shared header secret. Run it once from the physical phone.
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
  const [activeTab, setActiveTab] = useState<'setup' | 'status'>('setup');
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

  const qrPayload = useMemo(() => {
    if (!setup) return '';
    return `DEXARB PHONE PAYMENT MONITORING
Setup reference — not a MacroDroid import.
Reveal the secrets in DexArb → Connection details. Never share them.

PAYMENT NOTIFICATION MACRO
1. Add Macro.
2. Trigger: Device Events → Notification Received.
   Select only trusted banking apps. Enable Prevent multiple triggers if needed.
3. Action: Web Interactions → HTTP Request.
   Method: POST
   URL: ${setup.notify_url}
   Content type: application/json
   Header: X-Webhook-Secret = <Notification secret>
   Body: {"app":"{not_app_name}","title":"{not_title}","text":"{notification}"}
4. Save and test with a harmless real notification. Use MacroDroid's Magic Text picker for the values above.

PHONE HEARTBEAT MACRO
1. Add a second Macro.
2. Trigger: Date/Time → Regular Interval → every 5 minutes.
3. Action: Web Interactions → HTTP Request.
   Method: POST
   URL: ${setup.heartbeat_url}
   Content type: application/json
   Header: X-Webhook-Secret = <Heartbeat secret>
   Body: {"device_id":"payment-phone"}
4. Save and run it once manually. DexArb should show Phone online.

PHONE SETTINGS
• Grant Notification Access to MacroDroid.
• Exclude it from battery optimisation and allow background data/activity.
• Keep the payment and heartbeat macros separate.`;
  }, [setup]);

  const lastSeen = setup?.last_seen ? new Date(setup.last_seen).toLocaleString() : 'No check-in yet';
  const callbackHistory = setup?.callback_history ?? [];

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
            <div className="grid grid-cols-3 gap-x-2">
              <div className="flex min-w-0 items-baseline gap-1">
                <span className="shrink-0 text-[0.43rem] font-semibold uppercase tracking-wide text-muted">Connection</span>
                <p className={`truncate text-[0.55rem] font-medium ${setup.online ? 'text-green' : 'text-text'}`}>
                  {setup.online ? setup.device_id || 'Connected phone' : 'Not connected'}
                </p>
              </div>
              <div className="flex min-w-0 items-baseline gap-1">
                <span className="shrink-0 text-[0.43rem] font-semibold uppercase tracking-wide text-muted">Last heartbeat</span>
                <p className="truncate text-[0.55rem] font-medium text-text">{lastSeen}</p>
              </div>
              <div className="flex min-w-0 items-baseline gap-1">
                <span className="shrink-0 text-[0.43rem] font-semibold uppercase tracking-wide text-muted">Offline after</span>
                <p className="truncate text-[0.55rem] font-medium text-text">{Math.round(setup.max_age_seconds / 60)} minutes</p>
              </div>
            </div>

            {setup.heartbeat_status_error ? (
              <p className="mt-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[0.63rem] text-amber-600">
                {setup.heartbeat_status_error}
              </p>
            ) : null}

            <div className="mt-5 flex border-b border-border">
              {(['setup', 'status'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`border-b-2 px-3 py-2 text-[0.64rem] font-medium transition ${
                    activeTab === tab
                      ? 'border-blue text-blue'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  {tab === 'setup' ? 'Setup guide' : 'Status'}
                </button>
              ))}
            </div>

            {activeTab === 'setup' ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
              <div className="min-w-0">
                <div className="flex items-end justify-between gap-3 border-b border-border">
                  <div>
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-blue">Setup guide</p>
                    <p className="mt-0.5 text-[0.68rem] text-muted">Create the two MacroDroid macros on the phone.</p>
                  </div>
                </div>
                <SetupGuide
                  setup={setup}
                  secrets={secrets}
                  busy={busy}
                  onReveal={() => void reveal()}
                />
              </div>

              <aside className="w-full rounded-xl border border-blue/20 bg-blue/5 p-3">
                <div className="grid gap-3">
                  <div className="overflow-hidden rounded-lg border border-white/80 bg-white p-2 shadow-sm">
                    <LocalQrCode
                      value={qrPayload}
                      size={256}
                      alt="Non-secret combined phone monitoring setup reference QR code"
                      fallback="Use the connection details below instead."
                      className="mx-auto aspect-square w-full"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.64rem] font-semibold text-text">MacroDroid setup reference</p>
                      <span className="rounded bg-blue/10 px-1.5 py-0.5 text-[0.46rem] font-semibold uppercase tracking-wider text-blue">Guide QR</span>
                    </div>
                    <p className="mt-1.5 text-[0.55rem] leading-relaxed text-muted">
                      Scanning opens a plain-text setup guide with the live callback URLs, HTTP settings, MacroDroid Magic Text and five-minute heartbeat interval.
                    </p>
                    <p className="mt-2 text-[0.55rem] leading-relaxed text-muted">
                      It does not configure MacroDroid automatically. Follow the guide to create the trigger, HTTP actions, banking-app filter and timer, then add the revealed secrets separately.
                    </p>
                    <p className="mt-2 text-[0.52rem] font-medium text-blue">No credentials are stored in this code.</p>
                  </div>
                </div>
              </aside>
            </div>
            ) : (
              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-blue">Callback history</p>
                    <p className="mt-0.5 text-[0.68rem] text-muted">Accepted, blocked, and malformed phone callback attempts.</p>
                  </div>
                  <span className="text-[0.58rem] text-muted">Latest 50 requests</span>
                </div>
                {setup.callback_history_error ? (
                  <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[0.63rem] text-amber-600">
                    {setup.callback_history_error}
                  </p>
                ) : callbackHistory.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-border/80 bg-bg/35 px-3 py-5 text-center text-[0.65rem] text-muted">
                    No callback attempts have been recorded yet. Run the heartbeat macro once from the physical phone.
                  </p>
                ) : (
                  <div className="mt-3 overflow-hidden rounded-lg border border-border/80">
                    <div className="max-h-96 divide-y divide-border/70 overflow-y-auto">
                      {callbackHistory.map((attempt, index) => {
                        const blocked = attempt.outcome === 'blocked';
                        const accepted = attempt.outcome === 'accepted';
                        const label = attempt.endpoint === 'notify' ? 'Payment notification' : 'Phone heartbeat';
                        const actor = attempt.device_id || attempt.app || attempt.detail || 'No device or app label';
                        return (
                          <div key={`${attempt.received_at}-${attempt.endpoint}-${index}`} className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[1fr_auto] sm:items-center">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[0.64rem] font-medium text-text">{label}</span>
                                <span className={`rounded px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase tracking-wide ${
                                  accepted ? 'bg-green/10 text-green' : blocked ? 'bg-red/10 text-red' : 'bg-amber-500/10 text-amber-600'
                                }`}>{attempt.outcome}</span>
                                <span className="text-[0.55rem] text-muted">HTTP {attempt.status_code}</span>
                              </div>
                              <p className="mt-0.5 truncate text-[0.58rem] text-muted">{actor}</p>
                            </div>
                            <time className="text-[0.56rem] text-muted" dateTime={attempt.received_at}>
                              {new Date(attempt.received_at).toLocaleString()}
                            </time>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

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
                    label="Shared callback secret"
                    configured={setup.notify_credential_configured}
                    value={secrets?.shared_secret}
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
