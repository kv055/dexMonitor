import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import type { PaymentMethodGroup } from '../types';

export function usePaymentMethodGroups(): { groups: PaymentMethodGroup[]; loading: boolean } {
  const [groups, setGroups] = useState<PaymentMethodGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ groups: PaymentMethodGroup[] }>('/api/payment_method_groups')
      .then(data => setGroups(data.groups ?? []))
      .catch(err => console.error('Failed to load payment method groups:', err))
      .finally(() => setLoading(false));
  }, []);

  return { groups, loading };
}
