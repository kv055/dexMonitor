const EXCHANGE_STYLES: Record<string, string> = {
  hodlhodl: 'bg-[#1a3a2a99] text-green',
  robosats: 'bg-[#2a1a3a99] text-purple',
  bisq: 'bg-[#3a2a1a99] text-accent',
  peachbitcoin: 'bg-[#2d1a0e99] text-peach',
};

interface Props {
  exchange: string;
}

export function ExchangeTag({ exchange }: Props) {
  const cls = EXCHANGE_STYLES[exchange] ?? 'bg-surface text-muted';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-xl text-[0.7rem] font-semibold uppercase ${cls}`}>
      {exchange}
    </span>
  );
}
