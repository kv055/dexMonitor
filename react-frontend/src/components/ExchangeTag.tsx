const EXCHANGE_STYLES: Record<string, string> = {
  hodlhodl: 'bg-[#1a3a2a99] text-green',
  robosats: 'bg-[#2a1a3a99] text-purple',
  bisq: 'bg-[#3a2a1a99] text-accent',
  bisq2: 'bg-[#1a2a3a99] text-blue',
  peachbitcoin: 'bg-[#2d1a0e99] text-peach',
  mostro: 'bg-[#0e2d2a99] text-[#2dd4bf]',
  noones: 'bg-[#3a1a1a99] text-red',
};

const EXCHANGE_LABELS: Record<string, string> = {
  bisq: 'Bisq v1',
  bisq2: 'Bisq v2',
  mostro: 'Mostro',
};

interface Props {
  exchange: string;
}

export function ExchangeTag({ exchange }: Props) {
  const cls = EXCHANGE_STYLES[exchange] ?? 'bg-surface text-muted';
  const label = EXCHANGE_LABELS[exchange] ?? exchange;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-xl text-[0.7rem] font-semibold uppercase ${cls}`}>
      {label}
    </span>
  );
}
