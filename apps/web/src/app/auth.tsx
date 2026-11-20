import { hasPermission, type Permission } from '@ivamarg/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, refreshedUser, setAccessToken, setOnSessionExpired, tryRefresh } from '../lib/api';

export type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: { id: string; name: string };
  isAdmin: boolean;
  permissions: string[];
};

type AuthCtx = {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
};

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOnSessionExpired(() => {
      setAccessToken(null);
      setUser(null);
    });
    tryRefresh().then((ok) => {
      if (ok) setUser(refreshedUser as User);
      setReady(true);
    });
  }, []);

  const login = async (username: string, password: string) => {
    const r = await api<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', body: { username, password } });
    setAccessToken(r.accessToken);
    setUser(r.user);
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setAccessToken(null);
    setUser(null);
  };

  const can = (p: Permission) => !!user && hasPermission(user, p);

  return <Ctx.Provider value={{ user, ready, login, logout, can }}>{children}</Ctx.Provider>;
}
