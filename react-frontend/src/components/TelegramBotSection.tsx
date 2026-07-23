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

type Status = 'idle' | 'saving' | 'ok' | 'error';

interface FieldState {
  botToken: string;
  chatId: string;
  dexmmWebhookUrl: string;
  pushpushWebhookUrl: string;
}

const EMPTY: FieldState = { botToken: '', chatId: '', dexmmWebhookUrl: '', pushpushWebhookUrl: '' };

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

  const botFatherURL = 'https://t.me/BotFather?start=newbot';
  const botFatherQR = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&format=svg&data=${encodeURIComponent(botFatherURL)}`;
  const pairingQR = pairing ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=svg&data=${encodeURIComponent(pairing.deep_link)}` : '';

  return (
    <section className="rounded-lg border border-border bg-bg/50 p-2.5">
      <div className="mb-2">
        <h3 className="text-xs font-medium">Telegram Bot</h3>
        <p className="mt-0.5 text-[0.65rem] text-muted leading-tight">
          Connects the shared bot used for trade-chat relay, anomaly alerts, and fiat-arrival escalation. Credentials are stored in the shared database and hot-reloaded by both controllers.
        </p>
      </div>

      {!config?.bot_token_present && (
        <div className="mb-3 grid gap-4 rounded-lg border border-accent/25 bg-linear-to-br from-accent/8 via-surface to-bg p-3 sm:grid-cols-[220px_1fr] sm:items-center">
          <div className="flex flex-col items-center gap-1.5 rounded-md border border-border/70 bg-white p-2 shadow-sm">
            <img src={botFatherQR} width="196" height="196" alt="QR code to open Telegram BotFather" className="rounded" />
            <span className="text-[0.58rem] font-medium uppercase tracking-wide text-slate-600">Scan with Telegram</span>
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-[0.7rem] font-medium text-text">Connect your Telegram bot</p>
            <ol className="space-y-2 text-[0.65rem] text-muted">
              <li className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[0.6rem] font-semibold text-accent">1</span>
                <span><strong className="font-medium text-text">Scan the QR code</strong> and create a bot with BotFather.</span>
              </li>
              <li className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[0.6rem] font-semibold text-accent">2</span>
                <span><strong className="font-medium text-text">Copy its token</strong> from BotFather and paste it below.</span>
              </li>
              <li className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[0.6rem] font-semibold text-accent">3</span>
                <span><strong className="font-medium text-text">Save the connection.</strong> Use advanced settings only for custom routing.</span>
              </li>
            </ol>
            <a href={botFatherURL} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[0.62rem] text-accent hover:underline">Open BotFather on this device ↗</a>
          </div>
        </div>
      )}

      {pairing && !config?.chat_id && (
        <div className="mb-3 grid gap-4 rounded-lg border border-green/35 bg-linear-to-br from-green/10 via-surface to-bg p-3 sm:grid-cols-[220px_1fr] sm:items-center">
          <div className="flex flex-col items-center gap-1.5 rounded-md border border-border/70 bg-white p-2 shadow-sm">
            <img src={pairingQR} width="196" height="196" alt="QR code to connect your Telegram bot" className="rounded" />
            <span className="text-[0.58rem] font-medium uppercase tracking-wide text-slate-600">Scan, then press Start</span>
          </div>
          <div className="min-w-0 text-[0.65rem] text-muted leading-relaxed">
            <p className="mb-2 text-[0.7rem] font-medium text-text">Pair your phone</p>
            <p>Open the QR code in Telegram and press <strong className="font-medium text-text">Start</strong>. We will securely capture this private chat and enable alerts automatically.</p>
            <p className="mt-2">This pairing code expires at {new Date(pairing.expires_at).toLocaleTimeString()}.</p>
            <a href={pairing.deep_link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-accent hover:underline">Open the bot on this device ↗</a>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] uppercase tracking-wide text-muted">Bot token</span>
          <input
            type="password"
            autoComplete="off"
            placeholder={config?.bot_token_present ? '•••••• stored (type to replace)' : 'Paste bot token from BotFather'}
            value={fields.botToken}
            onChange={e => update({ botToken: e.target.value })}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
          />
        </label>

        <button
          type="button"
          onClick={() => setShowAdvanced(value => !value)}
          className="self-start text-[0.6rem] text-muted hover:text-text underline underline-offset-2"
        >
          {showAdvanced ? 'Hide' : 'Show'} advanced connection settings
        </button>

        {showAdvanced && <>
          <label className="flex flex-col gap-0.5">
            <span className="text-[0.6rem] uppercase tracking-wide text-muted">Chat ID</span>
            <input
              type="text"
              placeholder="e.g. 123456789"
              value={fields.chatId}
              onChange={e => update({ chatId: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent mono-nums"
            />
          </label>

          <p className="text-[0.6rem] text-muted leading-relaxed">
            Advanced routing only. Use this when your deployment needs explicit chat or webhook values.
          </p>

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
        </>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || busy === 'save'}
          className="text-[0.65rem] px-2 py-0.5 rounded-md border border-accent/60 text-accent hover:bg-accent/10 disabled:opacity-40 disabled:hover:bg-transparent font-medium"
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {config?.bot_token_present && !config.chat_id && !pairing && (
          <button
            type="button"
            onClick={handleStartPairing}
            disabled={busy === 'pair'}
            className="text-[0.65rem] px-2 py-0.5 rounded-md border border-accent/60 text-accent hover:bg-accent/10 disabled:opacity-40 font-medium"
          >
            {busy === 'pair' ? 'Preparing QR…' : 'Pair phone'}
          </button>
        )}
        <button
          type="button"
          onClick={() => handleTest('dexmm')}
          disabled={busy === 'test:dexmm' || !config?.bot_token_present}
          className="text-[0.65rem] px-2 py-0.5 rounded-md border border-border text-muted hover:border-muted hover:text-text disabled:opacity-40"
        >
          {busy === 'test:dexmm' ? 'Sending…' : 'Send test message'}
        </button>
        {message && (
          <span className={`text-[0.6rem] ${status === 'error' ? 'text-red' : status === 'ok' ? 'text-green' : 'text-muted'}`}>
            {message}
          </span>
        )}
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
          className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={onSet}
          disabled={busy || value.trim() === ''}
          className="shrink-0 text-[0.6rem] px-1.5 py-1 rounded border border-border text-muted hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {busy ? '…' : 'Set webhook'}
        </button>
      </div>
    </div>
  );
}
