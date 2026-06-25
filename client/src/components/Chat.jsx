import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { useAuth } from '../context/AuthContext.jsx';
import { messageTime, formatDateTime } from '../lib/format.js';
import { Loading } from './ui.jsx';

const USER_COLORS = [
  '#ff7f50', '#1e90ff', '#00ff7f', '#ff69b4', '#ffd700',
  '#9acd32', '#00ced1', '#ff4500', '#da70d6', '#7fffd4',
  '#ff6347', '#40e0d0', '#ee82ee', '#adff2f', '#87cefa',
  '#f08080', '#20b2aa', '#ba55d3', '#ffa07a', '#5f9ea0',
];

function userColor(name) {
  if (!name) return USER_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

export default function Chat({ room, title }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  // Gecmis (REST)
  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/chat/${encodeURIComponent(room)}/messages?limit=50`)
      .then(({ messages }) => {
        if (active) setMessages(messages);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [room]);

  // Canli (socket)
  useEffect(() => {
    const socket = getSocket();
    socket.emit('chat:join', room);
    const onMessage = (m) => {
      if (m.room === room) setMessages((prev) => [...prev, m]);
    };
    const onDeleted = ({ id, room: r }) => {
      if (r !== room) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, isDeleted: true, content: null } : m))
      );
    };
    socket.on('chat:message', onMessage);
    socket.on('chat:deleted', onDeleted);
    return () => {
      socket.emit('chat:leave', room);
      socket.off('chat:message', onMessage);
      socket.off('chat:deleted', onDeleted);
    };
  }, [room, user?.id]);

  // Otomatik kaydir
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    (e) => {
      e.preventDefault();
      const content = text.trim();
      if (!content) return;
      setSending(true);
      setError('');
      getSocket().emit('chat:send', { room, content }, (resp) => {
        setSending(false);
        if (resp?.ok) setText('');
        else setError(resp?.error || 'Mesaj gönderilemedi.');
      });
    },
    [text, room]
  );

  const remove = useCallback(async (id) => {
    try {
      await api.post(`/admin/messages/${id}/delete`);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const canSend = user && !user.isBanned && !user.isMuted;

  return (
    <div className="chat chat--stream">
      <div className="chat__head">
        <span className="chat__title">{title || 'Sohbet'}</span>
        <span className="chat__pin" title="Sabitle">📌</span>
      </div>

      <div className="chat__messages" ref={listRef}>
        {loading ? (
          <Loading />
        ) : messages.length === 0 ? (
          <div className="empty">Henüz mesaj yok. İlk yazan sen ol.</div>
        ) : (
          messages.map((m) => {
            const isAdmin = m.role === 'admin';
            const color = isAdmin ? '#5aa9ff' : userColor(m.username);
            return (
              <div
                key={m.id}
                className={`msg ${m.isDeleted ? 'msg--deleted' : ''}`}
                title={formatDateTime(m.createdAt)}
              >
                {isAdmin && <span className="msg__badge msg__badge--admin" title="admin">★</span>}
                <span className="msg__user" style={{ color }}>
                  {m.username}
                </span>
                <span className="msg__sep">:</span>{' '}
                <span className="msg__body">
                  {m.isDeleted ? <em>Bu mesaj silindi.</em> : m.content}
                </span>
                {user?.role === 'admin' && !m.isDeleted && (
                  <button className="msg__del" onClick={() => remove(m.id)} title="Mesajı sil">
                    ×
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {user ? (
        canSend ? (
          <form className="chat__form" onSubmit={send}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Bir mesaj gönderin"
              maxLength={1000}
            />
            <button type="button" className="chat__cog" title="Sohbet ayarları" tabIndex={-1}>
              ⚙
            </button>
            <button
              type="submit"
              className="chat__send"
              disabled={sending || !text.trim()}
            >
              Gönder
            </button>
          </form>
        ) : (
          <div className="chat__notice">
            {user.isBanned
              ? 'Hesabınız banlandı, mesaj gönderemezsiniz.'
              : 'Susturuldunuz, şu an mesaj gönderemezsiniz.'}
          </div>
        )
      ) : (
        <div className="chat__notice">
          <Link to="/giris" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Giriş yap
          </Link>{' '}
          ve sohbete katıl.
        </div>
      )}

      {error && (
        <div className="chat__notice chat__notice--err">{error}</div>
      )}
    </div>
  );
}
