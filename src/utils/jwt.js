import jwt from 'jsonwebtoken';
import 'dotenv/config';

const JWT_SECRET = process.env.JWT_SECRET || 'pizzahub_default_jwt_secret_key_change_in_production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Generate a signed JWT token
 * @param {Object} payload - User identification payload (id, email, role)
 * @returns {string} Signed JWT token
 */
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verify a JWT token
 * @param {string} token
 * @returns {Object} Decoded token payload
 */
export function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET);
}
