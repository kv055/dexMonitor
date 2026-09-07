// Same palette as ExchangeTag's EXCHANGE_STYLES (index.css --color-* tokens),
// duplicated here as hex since chart line series need a plain color string.
export const EXCHANGE_COLORS: Record<string, string> = {
  hodlhodl: '#3fb950',
  robosats: '#bc8cff',
  bisq: '#f7931a',
  bisq2: '#58a6ff',
  peachbitcoin: '#FF6B35',
  mostro: '#2dd4bf',
};

const DEFAULT_EXCHANGE_COLOR = '#8b949e';

export function exchangeColor(exchange: string): string {
  return EXCHANGE_COLORS[exchange] ?? DEFAULT_EXCHANGE_COLOR;
}
