import { ROLES } from '../models/schemas.js';

/**
 * Generic Role Verification Middleware Factory
 * @param {...string} allowedRoles - Roles permitted to access the route
 */
export function verifyRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required before role validation.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_ROLE',
        message: `Forbidden. Access restricted to [${allowedRoles.join(', ')}] role(s).`,
      });
    }

    next();
  };
}

// Pre-configured role middlewares for clean route definitions
export const verifyAdmin = verifyRole(ROLES.ADMIN);
export const verifyVendor = verifyRole(ROLES.VENDOR);
export const verifyCustomer = verifyRole(ROLES.CUSTOMER);
export const verifyVendorOrAdmin = verifyRole(ROLES.VENDOR, ROLES.ADMIN);
