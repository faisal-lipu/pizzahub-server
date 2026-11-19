import express from 'express';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { verifyAdmin } from '../middlewares/verifyRole.js';

const router = express.Router();

// Protect all transaction routes - strictly accessible only by platform Administrators
router.use(verifyToken, verifyAdmin);

/**
 * GET /api/transactions
 * Retrieve all platform subscription transactions with vendor details
 * Strict Requirement: Read-only access. Admins cannot edit or modify payment records.
 * Query params: ?status=completed&plan=premium
 */
router.get('/', async (req, res) => {
  try {
    const { status, plan } = req.query;
    const query = {};

    if (status && status.trim() !== '') {
      query.status = status.toLowerCase().trim();
    }

    if (plan && plan.trim() !== '') {
      query.plan = plan.toLowerCase().trim();
    }

    const pipeline = [
      { $match: query },
      // Lookup vendor information for each transaction
      {
        $lookup: {
          from: 'users',
          let: { vId: '$vendorId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: [{ $toString: '$_id' }, '$$vId'] },
                    { $eq: ['$_id', '$$vId'] },
                  ],
                },
              },
            },
            {
              $project: {
                name: 1,
                email: 1,
                businessName: 1,
                image: 1,
                subscriptionPlan: 1,
              },
            },
          ],
          as: 'vendor',
        },
      },
      {
        $unwind: {
          path: '$vendor',
          preserveNullAndEmptyArrays: true,
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    const transactions = await collections.transactions.aggregate(pipeline).toArray();

    return res.status(200).json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    console.error('[Admin Get Transactions Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch platform transactions.',
    });
  }
});

/**
 * GET /api/transactions/stats
 * Aggregated transaction and revenue stats for Admin Dashboard overview
 */
router.get('/stats', async (req, res) => {
  try {
    const [totalTransactions, completedTransactions, revenueAgg] = await Promise.all([
      collections.transactions.countDocuments(),
      collections.transactions.countDocuments({ status: 'completed' }),
      collections.transactions
        .aggregate([
          { $match: { status: 'completed' } },
          { $group: { _id: null, totalRevenue: { $sum: '$amount' } } },
        ])
        .toArray(),
    ]);

    const totalRevenue = revenueAgg.length > 0 ? revenueAgg[0].totalRevenue : 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalTransactions,
        completedTransactions,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        currency: 'usd',
      },
    });
  } catch (error) {
    console.error('[Admin Transaction Stats Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve transaction statistics.',
    });
  }
});

export default router;
