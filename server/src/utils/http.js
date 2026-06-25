export class ApiError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} message Admin/log için ayrıntılı mesaj
   * @param {string} [publicMessage] Üye/ziyaretçi için yumuşatılmış mesaj
   *   (verilmezse `message` herkese gösterilir)
   */
  constructor(status, message, publicMessage) {
    super(message);
    this.status = status;
    this.publicMessage = publicMessage || null;
  }
}

/** Express async route handler -> hatalari next()'e iletir. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
