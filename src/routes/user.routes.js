import express from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { verifyAdmin } from '../middlewares/verifyRole.js';
import { ROLES } from '../models/schemas.js';

const router = express.Router();

// Protect all user management routes - accessible only by Admins
router.use(verifyToken, verifyAdmin);

/**
 * GET /api/users
 * Fetch all registered users with search and role filtering
 * Query params: ?search=john&role=vendor&isBlocked=false
 */
router.get('/', async (req, res) => {
  try {
    const { search, role, isBlocked } = req.query;
    const query = {};

    // Search by name or email
    if (search && search.trim() !== '') {
      query.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { email: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    // Filter by specific role (vendor, customer, admin)
    if (role && Object.values(ROLES).includes(role.toLowerCase())) {
      query.role = role.toLowerCase();
    }

    // Filter by block status
    if (isBlocked !== undefined) {
      query.isBlocked = isBlocked === 'true';
    }

    // Sort users newest first
    const users = await collections.users
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error('[Get Users Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch users list.',
    });
  }
});

/**
 * GET /api/users/stats
 * Aggregated user statistics for Admin Dashboard overview
 */
router.get('/stats', async (req, res) => {
  try {
    const [
      totalUsers,
      totalVendors,
      totalCustomers,
      totalAdmins,
      blockedUsers,
    ] = await Promise.all([
      collections.users.countDocuments(),
      collections.users.countDocuments({ role: ROLES.VENDOR }),
      collections.users.countDocuments({ role: ROLES.CUSTOMER }),
      collections.users.countDocuments({ role: ROLES.ADMIN }),
      collections.users.countDocuments({ isBlocked: true }),
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalAdmins,
        blockedUsers,
      },
    });
  } catch (error) {
    console.error('[User Stats Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load user statistics.',
    });
  }
});

/**
 * PATCH /api/users/:id/block
 * Block or Unblock a user
 * Body: { "isBlocked": true } or { "isBlocked": false }
 */
router.patch('/:id/block', async (req, res) => {
  try {
    const { id } = req.params;
    const { isBlocked } = req.body;

    // Validate MongoDB ObjectId format
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format.',
      });
    }

    // Safety rule: Admin cannot block their own account
    if (req.user._id === id) {
      return res.status(400).json({
        success: false,
        message: 'Admins cannot block their own account.',
      });
    }

    const targetUser = await collections.users.findOne({ _id: new ObjectId(id) });
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    // Toggle if not explicitly provided
    const newBlockedState = isBlocked !== undefined ? Boolean(isBlocked) : !targetUser.isBlocked;

    await collections.users.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isBlocked: newBlockedState } }
    );

    return res.status(200).json({
      success: true,
      message: `User has been successfully ${newBlockedState ? 'blocked' : 'unblocked'}.`,
      isBlocked: newBlockedState,
      userId: id,
    });
  } catch (error) {
    console.error('[Block/Unblock User Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update user block status.',
    });
  }
});

export default router;
