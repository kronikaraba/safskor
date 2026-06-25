import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Bir macin canli oyuncu puanlarini yonetir.
 * - averages: { [playerId]: { average, count } }
 * - mine:     { [playerId]: score }
 * - closed:   puanlama kapandi mi (mac bitti)
 * - submit(playerId, score): Promise
 */
export function useMatchRatings(matchId) {
  const { user } = useAuth();
  const [averages, setAverages] = useState({});
  const [mine, setMine] = useState({});
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get(`/ratings/${matchId}`)
      .then(({ averages, mine }) => {
        if (!active) return;
        setAverages(averages || {});
        setMine(mine || {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [matchId, user?.id]);

  useEffect(() => {
    const socket = getSocket();
    const mid = Number(matchId);
    socket.emit('rating:join', mid);

    const onAverages = (p) => {
      if (Number(p.matchId) === mid) setAverages(p.averages || {});
    };
    const onUpdate = (agg) => {
      if (Number(agg.matchId) === mid) {
        setAverages((prev) => ({
          ...prev,
          [agg.playerId]: { playerId: agg.playerId, average: agg.average, count: agg.count },
        }));
      }
    };
    const onMine = (p) => {
      if (Number(p.matchId) === mid) setMine(p.ratings || {});
    };
    const onClosed = (p) => {
      if (Number(p.matchId) === mid) setClosed(true);
    };

    socket.on('rating:averages', onAverages);
    socket.on('rating:update', onUpdate);
    socket.on('rating:mine', onMine);
    socket.on('rating:closed', onClosed);

    return () => {
      socket.emit('rating:leave', mid);
      socket.off('rating:averages', onAverages);
      socket.off('rating:update', onUpdate);
      socket.off('rating:mine', onMine);
      socket.off('rating:closed', onClosed);
    };
  }, [matchId, user?.id]);

  const submit = useCallback(
    (playerId, score) =>
      new Promise((resolve, reject) => {
        getSocket().emit('rating:submit', { matchId: Number(matchId), playerId, score }, (resp) => {
          if (resp?.ok) {
            setMine((prev) => ({ ...prev, [playerId]: score }));
            resolve(resp);
          } else {
            reject(new Error(resp?.error || 'Puan kaydedilemedi.'));
          }
        });
      }),
    [matchId]
  );

  return { averages, mine, closed, submit };
}
