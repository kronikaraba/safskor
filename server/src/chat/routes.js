import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import { parseRoom } from '../realtime/rooms.js';
import { listMessages } from '../store/messages.js';

export const chatRouter = Router();

// GET /api/chat/:room/messages?beforeId=&limit=
// room: 'match:123' veya 'player:123:456' (URL-encoded)
chatRouter.get(
  '/:room/messages',
  asyncHandler(async (req, res) => {
    const room = req.params.room;
    if (!parseRoom(room)) throw new ApiError(400, 'Geçersiz sohbet odası.');
    // Geçersiz sayılar NaN olup SQL'i patlatmasın diye güvenli parse.
    const beforeIdNum = Number(req.query.beforeId);
    const beforeId = Number.isInteger(beforeIdNum) && beforeIdNum > 0 ? beforeIdNum : null;
    const limitNum = Number(req.query.limit);
    const limit = Number.isInteger(limitNum) && limitNum > 0 ? limitNum : 50;
    res.json({
      room,
      messages: await listMessages({ room, beforeId, limit, userId: req.user?.id ?? null }),
    });
  })
);
