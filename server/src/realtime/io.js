// Socket.IO ornegini REST rotalarinin da kullanabilmesi icin tutar
// (orn. admin mesaj silince odaya 'chat:deleted' yayini).
let io = null;

export function setIo(instance) {
  io = instance;
}

export function getIo() {
  return io;
}
