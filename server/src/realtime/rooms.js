// Sohbet odasi adlandirmasi:
//   match:{matchId}               -> macin genel sohbeti
//   player:{matchId}:{playerId}   -> bir oyuncunun mac bazli sohbeti
//   ratings:{matchId}             -> canli puan ortalamalari yayini

export function matchRoom(matchId) {
  return `match:${matchId}`;
}

export function playerRoom(matchId, playerId) {
  return `player:${matchId}:${playerId}`;
}

export function ratingsRoom(matchId) {
  return `ratings:${matchId}`;
}

export function suggestionsRoom(matchId) {
  return `suggestions:${matchId}`;
}

export function parseRoom(room) {
  if (typeof room !== 'string') return null;
  const asMatch = /^match:(\d+)$/.exec(room);
  if (asMatch) {
    return { scope: 'match', matchId: Number(asMatch[1]), playerId: null, room };
  }
  const asPlayer = /^player:(\d+):(\d+)$/.exec(room);
  if (asPlayer) {
    return {
      scope: 'player',
      matchId: Number(asPlayer[1]),
      playerId: Number(asPlayer[2]),
      room,
    };
  }
  return null;
}
