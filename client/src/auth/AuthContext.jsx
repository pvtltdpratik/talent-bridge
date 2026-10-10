import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, sessionStore } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!sessionStore.get());

  const loadMe = useCallback(async () => {
    try {
      setUser(await api.get('/auth/me'));
    } catch {
      sessionStore.set(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (sessionStore.get()) {
      api
        .get('/auth/me')
        .then((u) => active && setUser(u))
        .catch(() => sessionStore.set(null))
        .finally(() => active && setLoading(false));
    }
    // if the refresh token is rejected the store is cleared: drop the user too
    const unsubscribe = sessionStore.subscribe((s) => {
      if (!s) {
        setUser(null);
        qc.clear();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [qc]);

  const login = useCallback(
    async (email, password) => {
      const data = await api.post('/auth/login', { email, password });
      sessionStore.set(data.session);
      setUser(data.user);
      qc.clear();
      return data.user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* already signed out */
    }
    sessionStore.set(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const value = useMemo(() => ({ user, loading, login, logout, refreshUser: loadMe }), [user, loading, login, logout, loadMe]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export const HOME_BY_ROLE = { student: '/student', placement_cell: '/placement', admin: '/admin' };
