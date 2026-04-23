import { createContext, useContext } from 'react';

interface TimezoneContextValue {
  timezone: string;
}

export const TimezoneContext = createContext<TimezoneContextValue | null>(null);

export function useTimezone(): TimezoneContextValue {
  const ctx = useContext(TimezoneContext);
  if (!ctx) throw new Error('useTimezone must be used inside <TimezoneProvider>');
  return ctx;
}
