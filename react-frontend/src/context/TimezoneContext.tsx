import { createContext, useContext, type ReactNode } from 'react';

interface TimezoneContextValue {
  timezone: string;
}

const TimezoneContext = createContext<TimezoneContextValue | null>(null);

interface Props {
  timezone: string;
  children: ReactNode;
}

export function TimezoneProvider({ timezone, children }: Props) {
  return (
    <TimezoneContext.Provider value={{ timezone }}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone(): TimezoneContextValue {
  const ctx = useContext(TimezoneContext);
  if (!ctx) throw new Error('useTimezone must be used inside <TimezoneProvider>');
  return ctx;
}
