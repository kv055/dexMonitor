import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import type { PaymentMethodGroup } from '../types';

// While the server-side cache is still empty (it self-populates a few seconds
// after boot), re-poll on this interval so a client that loaded during the boot
// window recovers without a manual reload.
const EMPTY_POLL_MS = 10_000;

export function usePaymentMethodGroups(): { groups: PaymentMethodGroup[]; loading: boolean } {
  const [groups, setGroups] = useState<PaymentMethodGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      apiFetch<{ groups: PaymentMethodGroup[] }>('/api/payment_method_groups')
        .then(data => {
          if (cancelled) return;
          const next = data.groups ?? [];
          setGroups(next);
          // Keep polling until the cache is populated.
          if (next.length === 0) timer = setTimeout(load, EMPTY_POLL_MS);
        })
        .catch(err => {
          if (cancelled) return;
          console.error('Failed to load payment method groups:', err);
          timer = setTimeout(load, EMPTY_POLL_MS);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { groups, loading };
}
