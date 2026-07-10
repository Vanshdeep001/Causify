// =============================================
// Express Type Extensions
// =============================================
// Extends Express Request interface to include
// custom properties set by our middleware.
// =============================================

import { TokenPayload } from '../utils/generateToken';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      requestId?: string;
    }
  }
}

export {};
