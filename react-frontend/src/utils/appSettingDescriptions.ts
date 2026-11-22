// Info-icon texts for the AppSettingsPage, keyed by the env var name.
//
// Frontend-owned on purpose: these are UI copy, not API contract. Keeping them
// here means wording tweaks ship with the next frontend build alone — no
// dexmonitor (Go) rebuild, since the schema served by /api/app-settings
// stays the whitelist for keys, types, defaults and restart services.
export const appSettingDescriptions: Record<string, string> = {
  PUBLIC_HOSTNAME:
    'The domain name visitors use to reach this deployment over HTTPS (e.g. dex.example.com). Nginx uses it for the TLS certificate, and the API services use it to build correct links.',
  LETSENCRYPT_EMAIL:
    "Email address Let's Encrypt uses for certificate expiry warnings and security notices. Should be a mailbox you actually check.",
  DEXMM_TELEGRAM_WEBHOOK_URL:
    'The public URL where Telegram delivers your replies. When you answer a bot message, Telegram posts it to this address so the bot can act on it.',
  SESSION_COOKIE_SECURE:
    'When true, login cookies are only sent over HTTPS. Keep this on in production; only turn it off when testing locally over plain HTTP.',
  TELEGRAM_BOT_TOKEN:
    "The access token for the Telegram operator bot, shared by the market-maker and fiat controllers. Anyone with this token can read and send messages as your bot — keep it secret.",
  TELEGRAM_CHAT_ID:
    'The Telegram chat that receives trade-chat relays and anomaly alerts. Usually your own user ID or a group chat ID.',
  TELEGRAM_WEBHOOK_SECRET:
    "A long random string that Telegram must include in every callback. Requests without it are rejected, so strangers can't pretend to be Telegram.",
  PUSHPUSH_NOTIFY_SECRET:
    'A long random string that your Android phone includes in payment callbacks. If empty, callbacks are rejected entirely (fail-closed).',
  PUSHPUSH_HEARTBEAT_MAX_AGE:
    "How long without a heartbeat from your phone before it's reported as offline in the dashboard. Default: 15m.",
  PUSHPUSH_DEX_RELEASE_URL:
    'The mm-controller endpoint that the fiat controller calls to release BTC from escrow once a fiat payment is confirmed.',
  PUSHPUSH_DEX_RELEASE_TOKEN:
    'The bearer token that authenticates the DEX release webhook call between the fiat controller and mm-controller.',
  PUSHPUSH_RELEASE_TIMEOUT:
    'How long the fiat controller waits for the DEX release webhook to respond before giving up. Default: 10s.',
  PUSHPUSH_TELEGRAM_WEBHOOK_URL:
    'Where ambiguous push notifications get escalated to Telegram for a human decision. Leave empty to disable escalation.',
  MADDY_HOSTNAME:
    "The DNS name of the Maddy mail server. The domain's MX record must point here.",
  MADDY_DOMAIN:
    'The email domain you receive payment notifications on (e.g. example.com). Its MX record points at the mail hostname above.',
  MADDY_RECIPIENT:
    'The exact mailbox address that receives payment notification emails (e.g. payments@example.com).',
  MADDY_IMAP_PASSWORD:
    'The password the payment-email reader uses to log into the mailbox via IMAP.',
  PAYMENT_EMAIL_MODE:
    "Rollout stage for email-based payment detection. capture only records mails, shadow compares against the phone's answers without acting, active trusts them. Active requires both watermarks below.",
  PAYMENT_EMAIL_POLL_INTERVAL:
    'How often the payment inbox is checked for new mails. Default: 5m.',
  PAYMENT_EMAIL_HEALTH_MAX_AGE:
    'The payment-email check is flagged as stale in the dashboard if no poll succeeded within this window. Default: 15m.',
  PAYMENT_EMAIL_ACTIVATION_UID:
    'Safety watermark: the UID of the last email you manually reviewed. Active mode only accepts mail from this UID onward.',
  PAYMENT_EMAIL_ACTIVATION_TIME:
    'Safety watermark: the timestamp of the last email you manually reviewed. Active mode only accepts mail sent after this.',
  BISQ_API_PASSWORD:
    "Password for the Bisq 1 daemon's gRPC API on port 9998. Used by the API, snapshot and monitoring services to read offers and trades.",
  BISQ_WALLET_PASSWORD:
    "Unlocks the Bisq 1 daemon's Bitcoin wallet so it can sign transactions.",
  BISQ_ACCOUNT_FILE_PATH:
    'Optional: host path to the Bisq 1 account/data file, if you keep it somewhere other than the default location.',
  BISQ2_API_PASSWORD:
    "Password for the Bisq 2 daemon's REST API on port 8090.",
  BISQ2_WALLET_PASSWORD:
    "Unlocks the Bisq 2 daemon's Bitcoin wallet so it can sign transactions.",
  BISQ2_ACCOUNT_FILE_PATH:
    'Optional: host path to the Bisq 2 account/data file, if you keep it somewhere other than the default location.',
  PG_BACKUP_ENABLED: 'Master switch for scheduled Postgres database backups.',
  PG_BACKUP_INTERVAL: 'How often a full Postgres backup is taken. Default: 6h.',
  PG_BACKUP_RETENTION_DAYS: 'Backups older than this many days are deleted. Default: 14.',
  PG_BACKUP_UPLOAD: 'When true, finished backups are also uploaded to the rclone cloud target below.',
  PG_BACKUP_UPLOAD_REQUIRED:
    'When true, a failed upload marks the whole backup as failed so you notice it in the dashboard.',
  PG_BACKUP_RCLONE_REMOTE:
    'The rclone target backups are uploaded to, e.g. proton:postgres-backups/dexarb.',
  RCLONE_CONFIG_PROTON_USERNAME: 'The Proton Mail account rclone logs in with for backup uploads.',
  RCLONE_CONFIG_PROTON_PASSWORD:
    'The Proton account password — must be rclone-obscured (run rclone obscure), not plaintext.',
  ENABLE_AUTOMATED_TRADEFLOW_WORKERS:
    'Master switch for all automation that moves money on its own: recovery, DEX relay and hedgeless execution/refill workers. Keep off until everything passed testing.',
  SCRAPING_ENABLED:
    "Enables scraping fiat providers' websites as a last-resort way to detect incoming payments. Push notifications from your phone remain the primary path.",
  BISQ_FIAT_ESCALATION_AFTER:
    "How long a 'fiat sent' claim from a Bisq buyer may stay unconfirmed before you get an alert. 0 disables the alert. BTC is never auto-released. Default: 2h.",
  POLL_INTERVAL: 'How often the fiat controller re-checks payment state. Default: 30s.',
  FIAT_CONTROLLER_URL:
    'Where the fiat controller can be reached internally. The bid-side pre-trade checks fail closed (trading halts) if this is unreachable.',
  SNAPSHOT_INTERVAL_MIN:
    'How often the market snapshot service takes a fresh snapshot of balances, offers and prices. Default: 1 minute.',
  MM_CEX_CAPABILITY_MAX_AGE:
    'How fresh the CEX permission snapshot must be before new routes trust it. Older snapshots are ignored. Default: 30m.',
  COINBASE_WITHDRAW_RESERVE_FLOOR_SAT:
    'Minimum amount in sats always kept back in the Coinbase hot wallet — withdrawals never dip below this. Default: 10,000 sats.',
  COINBASE_WITHDRAW_RESERVE_MULTIPLIER:
    'Safety factor: withdrawals keep back this multiple of the expected next withdrawal in reserve, on top of the floor above. Default: 2×.',
  ROBOSATS_FEDERATION_URL: 'Where the snapshot service fetches the list of RoboSats federation nodes.',
  ROBOSATS_FEDERATION_REFRESH_INTERVAL:
    'How often the RoboSats federation node list is re-downloaded. Default: 6h.',
  LND_INIT_FRESH:
    'One-time escape hatch: on next start, LND creates a brand-new empty wallet instead of opening the existing one. Only for starting over — keep false.',
  GRAFANA_ADMIN_PASSWORD: "The password for the Grafana dashboard's admin login.",
};
