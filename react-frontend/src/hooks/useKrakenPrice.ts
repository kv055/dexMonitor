import { useEffect, useState } from 'react';

export function useKrakenPrice(): number | null {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    let ws: WebSocket;
    let dead = false;

    function connect() {
      ws = new WebSocket('wss://ws.kraken.com/v2');

      ws.onopen = () => {
        ws.send(JSON.stringify({
          method: 'subscribe',
          params: { channel: 'ticker', symbol: ['BTC/EUR'] },
        }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log('[Kraken WS]', msg);
        if (msg.channel === 'ticker' && Array.isArray(msg.data) && msg.data[0]?.last != null) {
          setPrice(msg.data[0].last);
        }
      };

      ws.onerror = (e) => console.error('[Kraken WS] error', e);

      ws.onclose = () => {
        if (!dead) setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      dead = true;
      ws?.close();
    };
  }, []);

  return price;
}
