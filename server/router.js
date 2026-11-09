import express from 'express';

/** Express 4 does not await handlers; this forwards async failures to the error middleware. */
function wrap(handler) {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

/**
 * Same API as express.Router(), but async handlers are safe.
 * Error middleware takes four arguments and must be left alone, otherwise
 * Express registers it as a normal middleware.
 */
export function createRouter() {
  const router = express.Router();
  for (const method of METHODS) {
    const original = router[method].bind(router);
    router[method] = (...args) =>
      original(...args.map((arg) => (typeof arg === 'function' && arg.length < 4 ? wrap(arg) : arg)));
  }
  return router;
}
