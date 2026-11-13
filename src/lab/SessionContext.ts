import { createContext, useContext } from 'react';
import type { LabSession } from './session';

export const SessionContext = createContext<LabSession | null>(null);

export function useSession(): LabSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside a SessionContext provider');
  return session;
}
