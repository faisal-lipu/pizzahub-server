import express from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { verifyAdmin } from '../middlewares/verifyRole.js';
import { ROLES } from '../models/schemas.js';

const router = express.Router();

// সব ইউজার ম্যানেজমেন্ট রাউট সুরক্ষিত - শুধুমাত্র অ্যাডমিন এক্সেস করতে পারবে
router.use(verifyToken, verifyAdmin);

/**
 * GET /api/users
 * সব ইউজারদের তালিকা দেখা (সার্চ এবং রোল ফিল্টারিং সহ)
 * Query parameters: ?search=john&role=vendor&isBlocked=false
 */
router.get('/', async (req, res) => {
  try {
    const { search, role, isBlocked } = req.query;
    const query = {};

    // নাম অথবা ইমেইল দিয়ে সার্চ করা
    if (search && search.trim() !== '') {
      query.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { email: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    // নির্দিষ্ট রোল অনুযায়ী ফিল্টার করা (vendor, customer, admin)
    if (role && Object.values(ROLES).includes(role.toLowerCase())) {
      query.role = role.toLowerCase();
    }

    // ব্লকড বা আনব্লকড ইউজার ফিল্টার করা
    if (isBlocked !== undefined) {
      query.isBlocked = isBlocked === 'true';
    }

    // নতুন ইউজাররা প্রথমে দেখানোর জন্য sort: { createdAt: -1 }
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
 * অ্যাডমিন ড্যাশবোর্ডের জন্য ইউজারদের সামগ্রিক পরিসংখ্যান
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
 * ইউজারকে Block অথবা Unblock করা
 * Body: { "isBlocked": true } অথবা { "isBlocked": false }
 */
router.patch('/:id/block', async (req, res) => {
  try {
    const { id } = req.params;
    const { isBlocked } = req.body;

    // আইডি ভ্যালিড MongoDB ObjectId কিনা চেক করা
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format.',
      });
    }

    // সেফটি রুল: অ্যাডমিন যেন নিজেকে নিজে ব্লক না করতে পারে
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

    // যদি বডিতে isBlocked দেওয়া থাকে তবে সেটি নেবে, না দিলে টগল করবে (True থাকলে False, False থাকলে True)
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
