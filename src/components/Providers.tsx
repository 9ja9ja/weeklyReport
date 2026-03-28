'use client';

import { UserProvider } from '@/lib/UserContext';
import { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  return <UserProvider>{children}</UserProvider>;
}
