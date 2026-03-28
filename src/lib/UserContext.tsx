'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface UserSession {
  userId: number | null;
  userName: string;
  teamId: number | null;
  teamName: string;
  role: 'superAdmin' | 'teamMaster' | 'user' | '';
}

interface UserContextType extends UserSession {
  setUser: (userId: number, userName: string, teamId: number, teamName: string, role: string) => void;
  clearUser: () => void;
  isMasterOrAbove: boolean;
  isSuperAdmin: boolean;
}

const STORAGE_KEY = 'wr_user_session';
const defaultSession: UserSession = { userId: null, userName: '', teamId: null, teamName: '', role: '' };

const UserContext = createContext<UserContextType>({
  ...defaultSession,
  setUser: () => {},
  clearUser: () => {},
  isMasterOrAbove: false,
  isSuperAdmin: false,
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<UserSession>(defaultSession);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) setSession(JSON.parse(stored));
    } catch {}
  }, []);

  const setUser = (userId: number, userName: string, teamId: number, teamName: string, role: string) => {
    const s: UserSession = { userId, userName, teamId, teamName, role: role as UserSession['role'] };
    setSession(s);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  };

  const clearUser = () => {
    setSession(defaultSession);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  const isMasterOrAbove = session.role === 'teamMaster' || session.role === 'superAdmin';
  const isSuperAdmin = session.role === 'superAdmin';

  return (
    <UserContext.Provider value={{ ...session, setUser, clearUser, isMasterOrAbove, isSuperAdmin }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
