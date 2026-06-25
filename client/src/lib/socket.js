import { io } from 'socket.io-client';
import { getToken } from './api.js';

// Prod'da Railway backend URL'ine bağlanır; lokal dev'de Vite proxy üzerinden.
const SOCKET_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = SOCKET_URL
      ? io(SOCKET_URL, { autoConnect: true, auth: { token: getToken() } })
      : io({ autoConnect: true, auth: { token: getToken() } });
  }
  return socket;
}

/** Giris/cikis sonrasi token degisince yeni el sikismayla yeniden baglan. */
export function reconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  return getSocket();
}
