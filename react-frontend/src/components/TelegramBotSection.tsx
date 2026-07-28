import { useEffect, useState } from 'react';
import {
	createTelegramPairing,
  fetchTelegramConfig,
  saveTelegramConfig,
  setTelegramWebhook,
  testTelegram,
  type TelegramConfig,
	 type TelegramPairing,
  type TelegramService,
} from '../utils/api';
import { LocalQrCode } from './LocalQrCode';

type Status = 'idle' | 'saving' | 'ok' | 'error';

interface FieldState {
  botToken: string;
  chatId: string;
  dexmmWebhookUrl: string;
  pushpushWebhookUrl: string;
}

const EMPTY: FieldState = { botToken: '', chatId: '', dexmmWebhookUrl: '', pushpushWebhookUrl: '' };

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M20.7 3.5 2.9 10.4c-1.2.5-1.2 1.2-.2 1.5l4.6 1.4 1.8 5.4c.2.6.1.9.8.9.5 0 .8-.2 1-.4l2.2-2.1 4.6 3.4c.8.5 1.5.2 1.7-.8l3-14.2c.3-1.3-.5-1.9-1.7-1.5ZM9 13l9-5.7c.4-.3.8-.1.5.2l-7.4 6.7-.3 3.2L9 13Z" />
    </svg>
  );
}

export function TelegramBotSection() {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [fields, setFields] = useState<FieldState>(EMPTY);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string>('');
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);

  useEffect(() => {
    let active = true;
    setStatus('idle');
    setMessage('');
    fetchTelegramConfig()
      .then(cfg => {
        if (!active) return;
        setConfig(cfg);
        setFields({
          botToken: '',
          chatId: cfg.chat_id,
          dexmmWebhookUrl: cfg.dexmm_webhook_url,
          pushpushWebhookUrl: cfg.pushpush_webhook_url,
        });
      })
      .catch(err => {
        if (!active) return;
        setStatus('error');
        setMessage(err.message ?? String(err));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => {
      fetchTelegramConfig().then(cfg => {
        setConfig(cfg);
        if (cfg.chat_id) {
          setPairing(null);
          setStatus('ok');
          setMessage('Telegram connected. A confirmation message was sent to your phone.');
        }
      }).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  const dirty =
    (fields.botToken !== '' && !config?.bot_token_present) ||
    fields.botToken !== '' ||
    fields.chatId !== (config?.chat_id ?? '') ||
    fields.dexmmWebhookUrl !== (config?.dexmm_webhook_url ?? '') ||
    fields.pushpushWebhookUrl !== (config?.pushpush_webhook_url ?? '');

  function update(patch: Partial<FieldState>) {
    setFields(prev => ({ ...prev, ...patch }));
  }

  async function handleSave() {
    setBusy('save');
    setStatus('saving');
    setMessage('');
    try {
      const payload: Record<string, string> = {};
      if (fields.botToken.trim() !== '') payload.bot_token = fields.botToken.trim();
      payload.chat_id = fields.chatId.trim();
      payload.dexmm_webhook_url = fields.dexmmWebhookUrl.trim();
      payload.pushpush_webhook_url = fields.pushpushWebhookUrl.trim();
      const saved = await saveTelegramConfig(payload);
      setConfig(saved);
      setFields(prev => ({
        ...prev,
        botToken: '',
        chatId: saved.chat_id,
        dexmmWebhookUrl: saved.dexmm_webhook_url,
        pushpushWebhookUrl: saved.pushpush_webhook_url,
      }));
      if (!saved.chat_id && fields.botToken.trim() !== '') {
        const nextPairing = await createTelegramPairing();
        setPairing(nextPairing);
        setStatus('ok');
        setMessage('Scan the pairing QR code in Telegram, then press Start.');
      } else {
        setStatus('ok');
        setMessage('Saved. DEXMM webhook re-registered with Telegram.');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function handleSetWebhook(service: TelegramService) {
    setBusy('webhook:' + service);
    setMessage('');
    try {
      const res = await setTelegramWebhook(service);
      if (res.ok) {
        setStatus('ok');
        setMessage(`${service === 'dexmm' ? 'DEXMM' : 'PUSHPUSH'} webhook registered with Telegram.`);
        if (config) {
          setConfig({
            ...config,
            dexmm_webhook_set: service === 'dexmm' ? true : config.dexmm_webhook_set,
            pushpush_webhook_set: service === 'pushpush' ? true : config.pushpush_webhook_set,
          });
        }
      } else {
        setStatus('error');
        setMessage(res.detail ?? 'setWebhook failed');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function handleStartPairing() {
    setBusy('pair');
    setMessage('');
    try {
      const nextPairing = await createTelegramPairing();
      setPairing(nextPairing);
      setStatus('ok');
      setMessage('Scan the pairing QR code in Telegram, then press Start.');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function handleTest(service: TelegramService) {
    setBusy('test:' + service);
    setMessage('');
    try {
      const res = await testTelegram(service);
      if (res.ok) {
        setStatus('ok');
        setMessage('Test message sent to the configured chat.');
      } else {
        setStatus('error');
        setMessage(res.detail ?? 'test failed');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  const botFatherURL = 'https://t.me/BotFather';
  const connected = Boolean(config?.bot_token_present && config.chat_id);
  const botTokenEntered = fields.botToken.trim() !== '';

  return (
    <section className="h-fit overflow-hidden rounded-xl border border-purple/30 bg-surface shadow-[0_12px_32px_rgba(0,0,0,0.08)]">
      <header className="relative overflow-hidden border-b border-purple/20 bg-linear-to-r from-purple/15 via-purple/7 to-transparent px-4 py-3.5">
        <div className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full bg-purple/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-purple text-white shadow-sm">
              <TelegramIcon />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text">Telegram bot</h3>
                <span className="rounded-full border border-purple/25 bg-purple/10 px-1.5 py-0.5 text-[0.52rem] font-semibold uppercase tracking-wider text-purple">
                  Messaging
                </span>
              </div>
              <p className="mt-0.5 text-[0.65rem] text-muted">Trade relay, anomaly alerts and payment escalation in one private chat.</p>
            </div>
          </div>
          {config ? (
            <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.62rem] font-medium ${
              connected
                ? 'border-green/30 bg-green/10 text-green'
                : 'border-purple/25 bg-purple/10 text-purple'
            }`}>
              <span className={`size-1.5 rounded-full ${connected ? 'bg-green shadow-[0_0_0_3px_rgba(63,185,80,0.15)]' : 'bg-purple'}`} />
              {connected ? 'Connected' : config.bot_token_present ? 'Pairing needed' : 'Not connected'}
            </span>
          ) : null}
        </div>
      </header>

      <div className="p-4">

      {!config?.bot_token_present && botTokenEntered && (
        <div className="mb-4 grid gap-3 rounded-xl border border-purple/20 bg-purple/5 p-3 sm:grid-cols-[9rem_1fr] sm:items-center">
          <div className="flex flex-col items-center gap-1.5 rounded-md border border-border/70 bg-white p-2 shadow-sm">
            <LocalQrCode
              value={botFatherURL}
              size={128}
              alt="QR code to open Telegram BotFather"
              fallback="Open BotFather with the link instead."
              className="rounded"
            />
            <span className="text-[0.58rem] font-medium uppercase tracking-wide text-slate-600">Scan with Telegram</span>
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-[0.72rem] font-semibold text-text">Connect in three steps</p>
            <ol className="space-y-1.5 text-[0.63rem] text-muted">
              <li className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-purple/15 text-[0.58rem] font-semibold text-purple">1</span>
                <span>Create a bot with <strong className="font-medium text-text">BotFather</strong>.</span>
              </li>
              <li className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-purple/15 text-[0.58rem] font-semibold text-purple">2</span>
                <span>Paste the token below and save.</span>
              </li>
              <li className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-purple/15 text-[0.58rem] font-semibold text-purple">3</span>
                <span>Pair your private chat when prompted.</span>
              </li>
            </ol>
            <a href={botFatherURL} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[0.62rem] font-medium text-purple hover:underline">Open BotFather ↗</a>
          </div>
        </div>
      )}

      {pairing && !config?.chat_id && (
        <div className="mb-4 grid gap-3 rounded-xl border border-green/30 bg-green/5 p-3 sm:grid-cols-[9rem_1fr] sm:items-center">
          <div className="flex flex-col items-center gap-1.5 rounded-md border border-border/70 bg-white p-2 shadow-sm">
            <LocalQrCode
              value={pairing.deep_link}
              size={128}
              alt="QR code to connect your Telegram bot"
              fallback="Open the bot with the link instead."
              className="rounded"
            />
            <span className="text-[0.58rem] font-medium uppercase tracking-wide text-slate-600">Scan, then press Start</span>
          </div>
          <div className="min-w-0 text-[0.65rem] text-muted leading-relaxed">
            <p className="mb-2 text-[0.7rem] font-medium text-text">Pair your phone</p>
            <p>Open the QR code in Telegram and press <strong className="font-medium text-text">Start</strong>. We will securely capture this private chat and enable alerts automatically.</p>
            <p className="mt-2">This pairing code expires at {new Date(pairing.expires_at).toLocaleTimeString()}.</p>
            <a href={pairing.deep_link} target="_blank" rel="noreferrer" className="mt-2 inline-block font-medium text-purple hover:underline">Open the bot ↗</a>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border/80 bg-bg/35 p-3">
        <p className="mb-3 text-[0.65rem] leading-relaxed text-muted">
          To get a token, open{' '}
          <a href={botFatherURL} target="_blank" rel="noreferrer" className="font-medium text-purple hover:underline">@BotFather</a>{' '}
          in Telegram, send <code className="rounded bg-surface px-1 py-0.5 text-[0.6rem] text-text">/newbot</code>, follow the prompts, then copy the token it sends you. Keep it private.
        </p>
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.58rem] font-semibold uppercase tracking-wider text-muted">Bot token</span>
          <input
            type="password"
            autoComplete="off"
            placeholder={config?.bot_token_present ? '•••••• stored (type to replace)' : 'Paste bot token from BotFather'}
            value={fields.botToken}
            onChange={e => update({ botToken: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-text outline-none transition focus:border-purple focus:ring-2 focus:ring-purple/10"
          />
        </label>

        <button
          type="button"
          onClick={() => setShowAdvanced(value => !value)}
          className="mt-2 flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-[0.62rem] font-medium text-muted transition hover:text-purple"
        >
          <span>{showAdvanced ? 'Hide' : 'Show'} advanced routing</span>
          <span className={`transition ${showAdvanced ? 'rotate-180' : ''}`}>⌄</span>
        </button>

        {showAdvanced && <div className="mt-2 grid gap-2 border-t border-border pt-3">
          <label className="flex flex-col gap-0.5">
            <span className="text-[0.6rem] uppercase tracking-wide text-muted">Chat ID</span>
            <input
              type="text"
              placeholder="e.g. 123456789"
              value={fields.chatId}
              onChange={e => update({ chatId: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-purple mono-nums"
            />
          </label>

          <WebhookField
            label="DEXMM webhook URL"
            value={fields.dexmmWebhookUrl}
            set={config?.dexmm_webhook_set ?? false}
            busy={busy === 'webhook:dexmm'}
            onChange={v => update({ dexmmWebhookUrl: v })}
            onSet={() => handleSetWebhook('dexmm')}
          />
          <WebhookField
            label="PUSHPUSH webhook URL"
            value={fields.pushpushWebhookUrl}
            set={config?.pushpush_webhook_set ?? false}
            busy={busy === 'webhook:pushpush'}
            onChange={v => update({ pushpushWebhookUrl: v })}
            onSet={() => handleSetWebhook('pushpush')}
          />
        </div>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || busy === 'save'}
          className="rounded-md bg-purple px-3 py-1.5 text-[0.65rem] font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-40"
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {config?.bot_token_present && !config.chat_id && !pairing && (
          <button
            type="button"
            onClick={handleStartPairing}
            disabled={busy === 'pair'}
            className="rounded-md border border-purple/40 bg-purple/5 px-2.5 py-1.5 text-[0.65rem] font-medium text-purple hover:bg-purple/10 disabled:opacity-40"
          >
            {busy === 'pair' ? 'Preparing QR…' : 'Pair phone'}
          </button>
        )}
        <button
          type="button"
          onClick={() => handleTest('dexmm')}
          disabled={busy === 'test:dexmm' || !config?.bot_token_present}
          className="rounded-md border border-border px-2.5 py-1.5 text-[0.65rem] text-muted transition hover:border-purple/40 hover:text-purple disabled:opacity-40"
        >
          {busy === 'test:dexmm' ? 'Sending…' : 'Send test message'}
        </button>
        {message && (
          <span className={`basis-full rounded-md border px-2.5 py-1.5 text-[0.61rem] ${
            status === 'error'
              ? 'border-red/25 bg-red/5 text-red'
              : status === 'ok'
                ? 'border-green/25 bg-green/5 text-green'
                : 'border-border bg-bg text-muted'
          }`}>
            {message}
          </span>
        )}
      </div>
      </div>
    </section>
  );
}

interface WebhookFieldProps {
  label: string;
  value: string;
  set: boolean;
  busy: boolean;
  onChange: (v: string) => void;
  onSet: () => void;
}

function WebhookField({ label, value, set, busy, onChange, onSet }: WebhookFieldProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[0.6rem] uppercase tracking-wide text-muted">{label}</span>
        <span className={`text-[0.55rem] uppercase tracking-wide border rounded px-0.5 py-px ${set ? 'border-green/40 text-green' : 'border-border text-muted'}`}>
          {set ? 'webhook set' : 'not set'}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          placeholder="https://your-host/telegram-webhook"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-purple"
        />
        <button
          type="button"
          onClick={onSet}
          disabled={busy || value.trim() === ''}
          className="shrink-0 rounded border border-border px-1.5 py-1 text-[0.6rem] text-muted hover:border-purple hover:text-purple disabled:opacity-40"
        >
          {busy ? '…' : 'Set webhook'}
        </button>
      </div>
    </div>
  );
}
