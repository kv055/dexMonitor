import type { ReactNode } from 'react';
import { TimezoneContext } from '../hooks/useTimezone';

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
