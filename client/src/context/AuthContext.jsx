import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, getToken } from '../lib/api.js';
import { reconnectSocket, getSocket } from '../lib/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (getToken()) {
        try {
          const { user } = await api.get('/auth/me');
          if (active) setUser(user);
        } catch {
          setToken(null);
        }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const applyAuth = useCallback((data) => {
    setToken(data.token);
    setUser(data.user);
    reconnectSocket();
  }, []);

  const login = useCallback(
    async (identifier, password) => {
      const data = await api.post('/auth/login', { identifier, password });
      applyAuth(data);
      return data.user;
    },
    [applyAuth]
  );

  const register = useCallback(
    async (username, email, password) => {
      const data = await api.post('/auth/register', { username, email, password });
      applyAuth(data);
      return data.user;
    },
    [applyAuth]
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    reconnectSocket();
  }, []);

  // Moderasyon olaylarini canli yansit (banlandi/susturuldu).
  useEffect(() => {
    if (!user) return undefined;
    const socket = getSocket();
    const onBanned = () => setUser((u) => (u ? { ...u, isBanned: true } : u));
    const onMuted = ({ until }) =>
      setUser((u) => (u ? { ...u, isMuted: true, mutedUntil: until } : u));
    const onUnmuted = () =>
      setUser((u) => (u ? { ...u, isMuted: false, mutedUntil: null } : u));
    socket.on('moderation:banned', onBanned);
    socket.on('moderation:muted', onMuted);
    socket.on('moderation:unmuted', onUnmuted);
    return () => {
      socket.off('moderation:banned', onBanned);
      socket.off('moderation:muted', onMuted);
      socket.off('moderation:unmuted', onUnmuted);
    };
  }, [user?.id]);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider icinde kullanilmali.');
  return ctx;
}
