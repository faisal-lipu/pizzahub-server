import express from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../config/db.js';
import { generateToken } from '../utils/jwt.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { ROLES, SUBSCRIPTION_PLANS, formatUserDocument } from '../models/schemas.js';

const router = express.Router();

/**
 * POST /api/auth/jwt
 * Generates or issues a JWT for authenticated users (Better Auth / Google OAuth sync)
 */
router.post('/jwt', async (req, res) => {
  try {
    const { email, name, image, role, businessName } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required to issue token.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user = await collections.users.findOne({ email: normalizedEmail });

    if (!user) {
      // Secure role assignment: Public registration cannot create Admin
      const sanitizedRole = role === ROLES.VENDOR ? ROLES.VENDOR : ROLES.CUSTOMER;

      const newUserDoc = formatUserDocument({
        name: name || 'User',
        email: normalizedEmail,
        image: image || null,
        role: sanitizedRole,
        businessName: sanitizedRole === ROLES.VENDOR ? (businessName || '') : null,
      });

      const insertResult = await collections.users.insertOne(newUserDoc);
      user = { _id: insertResult.insertedId, ...newUserDoc };
    }

    // Check if user is blocked
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        code: 'USER_BLOCKED',
        message: 'This account has been blocked. Access is restricted.',
      });
    }

    // Generate JWT
    const token = generateToken({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    return res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      token,
      user: {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        image: user.image || null,
        role: user.role,
        businessName: user.businessName || null,
        subscriptionPlan: user.subscriptionPlan || SUBSCRIPTION_PLANS.FREE,
        isBlocked: user.isBlocked || false,
      },
    });
  } catch (error) {
    console.error('[Auth /jwt Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to process authentication request.',
    });
  }
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile
 */
router.get('/me', verifyToken, async (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
});

/**
 * PATCH /api/auth/profile
 * Updates profile details (name, image, businessName)
 * Strictly prevents role or subscription tampering
 */
router.patch('/profile', verifyToken, async (req, res) => {
  try {
    const { name, image, businessName } = req.body;
    const updateDoc = {};

    if (name !== undefined) updateDoc.name = name.trim();
    if (image !== undefined) updateDoc.image = image.trim();
    if (businessName !== undefined && req.user.role === ROLES.VENDOR) {
      updateDoc.businessName = businessName.trim();
    }

    if (Object.keys(updateDoc).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update.',
      });
    }

    await collections.users.updateOne(
      { _id: new ObjectId(req.user._id) },
      { $set: updateDoc }
    );

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      updated: updateDoc,
    });
  } catch (error) {
    console.error('[Profile Update Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile.',
    });
  }
});

export default router;
