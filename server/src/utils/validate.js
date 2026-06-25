export function validateUsername(value) {
  if (typeof value !== 'string') return 'Kullanıcı adı gerekli.';
  const v = value.trim();
  if (v.length < 3 || v.length > 20) return 'Kullanıcı adı 3-20 karakter olmalı.';
  if (!/^[a-zA-Z0-9_]+$/.test(v)) return 'Kullanıcı adı sadece harf, rakam ve _ içerebilir.';
  return null;
}

export function validateEmail(value) {
  if (typeof value !== 'string') return 'E-posta gerekli.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Geçerli bir e-posta girin.';
  return null;
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 6) return 'Şifre en az 6 karakter olmalı.';
  if (value.length > 200) return 'Şifre çok uzun.';
  return null;
}
