export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Express async route handler -> hatalari next()'e iletir. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
