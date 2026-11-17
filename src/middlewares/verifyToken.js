import { ObjectId } from 'mongodb';
import { verifyJwt } from '../utils/jwt.js';
import { collections } from '../config/db.js';

/**
 * JWT Verification Middleware
 * Validates bearer token, checks expiration, verifies user existence,
 * and blocks unauthorized or banned users.
 */
export async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = verifyJwt(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          code: 'TOKEN_EXPIRED',
          message: 'Session expired. Please log in again.',
        });
      }
      return res.status(401).json({
        success: false,
        code: 'TOKEN_INVALID',
        message: 'Invalid token. Authorization failed.',
      });
    }

    // Lookup user in database
    const userQuery = ObjectId.isValid(decoded.id)
      ? { _id: new ObjectId(decoded.id) }
      : { email: decoded.email };

    const user = await collections.users.findOne(userQuery);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account not found or removed.',
      });
    }

    // Check if user is blocked by admin
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        code: 'USER_BLOCKED',
        message: 'Your account has been blocked by the administrator.',
      });
    }

    // Attach verified user to request
    req.user = {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      businessName: user.businessName || null,
      subscriptionPlan: user.subscriptionPlan || 'free',
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
      isBlocked: user.isBlocked || false,
    };

    next();
  } catch (error) {
    console.error('[verifyToken Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication verification.',
    });
  }
}
