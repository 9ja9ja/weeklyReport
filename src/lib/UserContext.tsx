'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface TeamRef {
  id: number;
  name: string;
  division: string;
  isPrimary: boolean;
}

interface UserSession {
  userId: number | null;
  userName: string;
  /** 주 소속 팀 */
  primaryTeamId: number | null;
  /** 현재 보고 있는 팀 (겸직 시 전환 가능) */
  activeTeamId: number | null;
  /** 소속 팀 전체 (주 소속 + 겸직) */
  teams: TeamRef[];
  role: 'superAdmin' | 'teamMaster' | 'executive' | 'user' | '';
  position: string;
}

export interface LoginUser {
  id: number;
  name: string;
  role: string;
  position?: string;
  teamId: number;
  teamName: string;
  division?: string;
  teams?: TeamRef[];
}

interface UserContextType extends UserSession {
  /** 현재 활성 팀 id — 기존 코드 호환용 별칭 */
  teamId: number | null;
  /** 현재 활성 팀 이름 */
  teamName: string;
  /** 현재 활성 팀의 구분 */
  division: string;
  setUserFromLogin: (user: LoginUser) => void;
  switchTeam: (teamId: number) => void;
  clearUser: () => void;
  isMasterOrAbove: boolean;
  isSuperAdmin: boolean;
  /** 임원 — 전체 취합본 조회 전용 계정 (작성 화면 없음) */
  isExecutive: boolean;
  /** 전체 취합본 조회 — 로그인한 직원이면 누구나 */
  canViewOverview: boolean;
  hasMultipleTeams: boolean;
  /** sessionStorage 복원 전이면 true — 이때 로그인 여부로 리다이렉트하면 안 된다 */
  isHydrating: boolean;
}

const STORAGE_KEY = 'wr_user_session';
const defaultSession: UserSession = {
  userId: null,
  userName: '',
  primaryTeamId: null,
  activeTeamId: null,
  teams: [],
  role: '',
  position: ''
};

const UserContext = createContext<UserContextType>({
  ...defaultSession,
  teamId: null,
  teamName: '',
  division: '',
  setUserFromLogin: () => {},
  switchTeam: () => {},
  clearUser: () => {},
  isMasterOrAbove: false,
  isSuperAdmin: false,
  isExecutive: false,
  canViewOverview: false,
  hasMultipleTeams: false,
  isHydrating: true
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<UserSession>(defaultSession);
  const [isHydrating, setIsHydrating] = useState(true);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      // 구버전 세션(teamId 단일) 호환
      if (parsed.teamId && !parsed.activeTeamId) {
        setSession({
          userId: parsed.userId ?? null,
          userName: parsed.userName ?? '',
          primaryTeamId: parsed.teamId,
          activeTeamId: parsed.teamId,
          teams: [{ id: parsed.teamId, name: parsed.teamName ?? '', division: '', isPrimary: true }],
          role: parsed.role ?? '',
          position: ''
        });
        return;
      }
      setSession(parsed);
    } catch {}
    finally { setIsHydrating(false); }
  }, []);

  /**
   * 브라우저에 남은 로그인 상태와 서버 세션 쿠키를 대조한다.
   * 쿠키가 만료됐거나 다른 계정이면 화면상 로그인 상태만 남아 API 가 전부 401 이 되므로,
   * 이때는 로컬 세션을 정리해 로그인 화면으로 돌려보낸다.
   */
  useEffect(() => {
    if (isHydrating || !session.userId) return;
    let alive = true;
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : { userId: null }))
      .then(d => {
        if (!alive) return;
        if (d.userId !== session.userId) {
          setSession(defaultSession);
          sessionStorage.removeItem(STORAGE_KEY);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrating, session.userId]);

  const persist = (s: UserSession) => {
    setSession(s);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  };

  const setUserFromLogin = (user: LoginUser) => {
    const teams: TeamRef[] =
      user.teams && user.teams.length > 0
        ? user.teams
        : [{ id: user.teamId, name: user.teamName, division: user.division ?? '', isPrimary: true }];

    persist({
      userId: user.id,
      userName: user.name,
      primaryTeamId: user.teamId,
      activeTeamId: user.teamId,
      teams,
      role: user.role as UserSession['role'],
      position: user.position ?? ''
    });
  };

  const switchTeam = (teamId: number) => {
    if (!session.teams.some(t => t.id === teamId)) return;
    persist({ ...session, activeTeamId: teamId });
  };

  const clearUser = () => {
    setSession(defaultSession);
    sessionStorage.removeItem(STORAGE_KEY);
    // 서버 세션 쿠키도 함께 파기한다 (실패해도 화면상 로그아웃은 진행)
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  };

  const activeTeam = session.teams.find(t => t.id === session.activeTeamId);

  return (
    <UserContext.Provider
      value={{
        ...session,
        teamId: session.activeTeamId,
        teamName: activeTeam?.name ?? '',
        division: activeTeam?.division ?? '',
        setUserFromLogin,
        switchTeam,
        clearUser,
        isMasterOrAbove: session.role === 'teamMaster' || session.role === 'superAdmin',
        isSuperAdmin: session.role === 'superAdmin',
        isExecutive: session.role === 'executive',
        canViewOverview: session.userId != null,
        hasMultipleTeams: session.teams.length > 1,
        isHydrating
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
