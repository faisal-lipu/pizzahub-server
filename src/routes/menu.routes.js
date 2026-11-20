import express from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { verifyVendor, verifyAdmin } from '../middlewares/verifyRole.js';
import {
  MENU_CATEGORIES,
  MENU_STATUS,
  SUBSCRIPTION_PLANS,
  formatMenuItemDocument,
} from '../models/schemas.js';

const router = express.Router();

/**
 * POST /api/menu
 * Create a new menu item for a vendor
 * Enforces free-tier limit of max 3 active/pending items
 */
router.post('/', verifyToken, verifyVendor, async (req, res) => {
  try {
    const rawName = (req.body.itemName || req.body.name || '').trim();
    const category = (req.body.category || '').trim();
    const description = (req.body.description || '').trim();
    const price = req.body.price;
    const location = (req.body.location || req.user.businessName || 'Downtown Kitchen, New York').trim();
    const images = req.body.images;
    const image = req.body.image;
    const preparationTime = parseInt(req.body.preparationTime, 10) || 15;

    // Validate required fields
    if (!rawName || !category || price === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Item name, category, and price are required.',
      });
    }

    // Validate category
    if (!MENU_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Allowed categories are: ${MENU_CATEGORIES.join(', ')}`,
      });
    }

    // Normalize image URLs
    const finalImages = Array.isArray(images) && images.length > 0
      ? images
      : image
      ? [image]
      : ['https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop&q=80'];

    // Check vendor subscription plan
    const vendor = await collections.users.findOne({ _id: new ObjectId(req.user._id) });
    const isPremium = vendor?.subscriptionPlan === SUBSCRIPTION_PLANS.PREMIUM;

    // Free plan rule: maximum 3 items (excluding rejected ones)
    if (!isPremium) {
      const currentItemCount = await collections.menuItems.countDocuments({
        vendorId: req.user._id,
        status: { $ne: MENU_STATUS.REJECTED },
      });

      if (currentItemCount >= 3) {
        return res.status(403).json({
          success: false,
          code: 'FREE_TIER_LIMIT_REACHED',
          message: 'Free plan allows a maximum of 3 active/pending menu items. Please upgrade to Premium to publish unlimited items.',
          limit: 3,
          currentCount: currentItemCount,
        });
      }
    }

    // Create menu item with default status 'pending'
    const newMenuItem = formatMenuItemDocument(
      { itemName: rawName, category, description, price, location, images: finalImages, preparationTime },
      req.user._id
    );

    const result = await collections.menuItems.insertOne(newMenuItem);

    return res.status(201).json({
      success: true,
      message: 'Menu item created successfully. It is pending admin approval.',
      item: { _id: result.insertedId, ...newMenuItem },
    });
  } catch (error) {
    console.error('[Add Menu Item Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to add menu item.',
    });
  }
});

/**
 * GET /api/menu/my-items (and /api/menu/vendor/my-items)
 * Fetch all menu items belonging to the authenticated vendor
 */
router.get(['/my-items', '/vendor/my-items'], verifyToken, verifyVendor, async (req, res) => {
  try {
    const items = await collections.menuItems
      .find({ vendorId: req.user._id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    console.error('[Get My Menu Items Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch your menu items.',
    });
  }
});

/**
 * GET /api/menu/my-items/:id
 * Retrieve single menu item details for owner vendor
 */
router.get('/my-items/:id', verifyToken, verifyVendor, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid menu item ID format.',
      });
    }

    const item = await collections.menuItems.findOne({
      _id: new ObjectId(id),
      vendorId: req.user._id,
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found or you do not have permission to view it.',
      });
    }

    return res.status(200).json({
      success: true,
      item,
    });
  } catch (error) {
    console.error('[Get Single Menu Item Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch menu item details.',
    });
  }
});

/**
 * PATCH /api/menu/my-items/:id
 * Update menu item details or toggle active status
 */
router.patch('/my-items/:id', verifyToken, verifyVendor, async (req, res) => {
  try {
    const { id } = req.params;
    const { itemName, category, description, price, location, images, status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid menu item ID format.',
      });
    }

    // Verify ownership
    const existingItem = await collections.menuItems.findOne({
      _id: new ObjectId(id),
      vendorId: req.user._id,
    });

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found or unauthorized to update.',
      });
    }

    const updateDoc = {};
    if (itemName !== undefined) updateDoc.itemName = itemName.trim();
    if (category !== undefined) {
      if (!MENU_CATEGORIES.includes(category)) {
        return res.status(400).json({ success: false, message: 'Invalid category.' });
      }
      updateDoc.category = category.trim();
    }
    if (description !== undefined) updateDoc.description = description.trim();
    if (price !== undefined) updateDoc.price = Number(price);
    if (location !== undefined) updateDoc.location = location.trim();
    if (images !== undefined) updateDoc.images = Array.isArray(images) ? images : [images];

    // Status toggle logic
    if (status !== undefined) {
      if ([MENU_STATUS.INACTIVE, MENU_STATUS.APPROVED].includes(status)) {
        updateDoc.status = status;
      }
    } else if (Object.keys(updateDoc).length > 0) {
      // Re-review required if item content changed
      updateDoc.status = MENU_STATUS.PENDING;
    }

    updateDoc.updatedAt = new Date();

    await collections.menuItems.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    );

    return res.status(200).json({
      success: true,
      message: 'Menu item updated successfully.',
      updated: updateDoc,
    });
  } catch (error) {
    console.error('[Update Menu Item Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update menu item.',
    });
  }
});

/**
 * DELETE /api/menu/my-items/:id
 * Delete menu item with ownership verification
 */
router.delete(['/my-items/:id', '/:id'], verifyToken, verifyVendor, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid menu item ID format.',
      });
    }

    // Ownership check
    const deleteResult = await collections.menuItems.deleteOne({
      _id: new ObjectId(id),
      vendorId: req.user._id,
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found or unauthorized to delete.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Menu item deleted successfully.',
    });
  } catch (error) {
    console.error('[Delete Menu Item Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete menu item.',
    });
  }
});

/* ==========================================================================
   ADMIN MENU MANAGEMENT & REVIEW ROUTES (Protected by verifyAdmin)
   ========================================================================== */

/**
 * GET /api/menu/admin/all
 * Retrieve all submitted menu items across all vendors
 * Query params: ?status=pending&category=Classic%20Pizzas&search=margherita
 */
router.get('/admin/all', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status, category, search } = req.query;
    const query = {};

    // Filter by item approval status
    if (status && Object.values(MENU_STATUS).includes(status.toLowerCase())) {
      query.status = status.toLowerCase();
    }

    // Filter by category
    if (category && MENU_CATEGORIES.includes(category)) {
      query.category = category;
    }

    // Search by item name or location
    if (search && search.trim() !== '') {
      query.$or = [
        { itemName: { $regex: search.trim(), $options: 'i' } },
        { location: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const items = await collections.menuItems
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    console.error('[Admin Get All Items Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch menu items for administration.',
    });
  }
});

/**
 * GET /api/menu/admin/stats
 * Aggregated menu statistics for Admin Dashboard overview
 */
router.get('/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const [totalItems, pendingItems, approvedItems, rejectedItems] = await Promise.all([
      collections.menuItems.countDocuments(),
      collections.menuItems.countDocuments({ status: MENU_STATUS.PENDING }),
      collections.menuItems.countDocuments({ status: MENU_STATUS.APPROVED }),
      collections.menuItems.countDocuments({ status: MENU_STATUS.REJECTED }),
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalItems,
        pendingItems,
        approvedItems,
        rejectedItems,
      },
    });
  } catch (error) {
    console.error('[Admin Menu Stats Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load menu statistics.',
    });
  }
});

/**
 * PATCH /api/menu/admin/:id/status
 * Review menu item: Approve, Reject, or change published status
 * Body: { "status": "approved" | "rejected" | "inactive" | "pending" }
 */
router.patch('/admin/:id/status', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid menu item ID format.',
      });
    }

    if (!status || !Object.values(MENU_STATUS).includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${Object.values(MENU_STATUS).join(', ')}`,
      });
    }

    const normalizedStatus = status.toLowerCase();

    const updateResult = await collections.menuItems.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status: normalizedStatus, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!updateResult) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Menu item status updated to '${normalizedStatus}'.`,
      item: updateResult,
    });
  } catch (error) {
    console.error('[Admin Update Status Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update menu item status.',
    });
  }
});

/**
 * DELETE /api/menu/admin/:id
 * Delete an inappropriate menu item (Admin privilege)
 */
router.delete('/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid menu item ID format.',
      });
    }

    const deleteResult = await collections.menuItems.deleteOne({
      _id: new ObjectId(id),
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Menu item permanently removed by administrator.',
    });
  } catch (error) {
    console.error('[Admin Delete Item Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete menu item.',
    });
  }
});

/* ==========================================================================
   PUBLIC MENU ROUTES (Accessible by everyone without login)
   ========================================================================== */

/**
 * GET /api/menu
 * Public route to browse approved menu items with search, filter, and sorting
 * Challenge #1: Advanced search and sorting by price (asc / desc)
 * Query params: ?search=cheese&category=Meat%20Lovers&location=Dhaka&sortBy=price&order=asc&limit=6
 */
router.get('/', async (req, res) => {
  try {
    const { search, category, location, sortBy, order, limit, page } = req.query;

    // Base query: Only approved items are visible to the public
    const query = { status: MENU_STATUS.APPROVED };

    // Search by item name or description
    if (search && search.trim() !== '') {
      query.$or = [
        { itemName: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    // Filter by category
    if (category && category.trim() !== '' && category.toLowerCase() !== 'all') {
      query.category = category.trim();
    }

    // Filter by location (city or restaurant area)
    if (location && location.trim() !== '') {
      query.location = { $regex: location.trim(), $options: 'i' };
    }

    // Challenge #1: Dynamic price sorting (Ascending / Descending)
    const sortCriteria = {};
    if (sortBy === 'price') {
      sortCriteria.price = order === 'asc' ? 1 : -1;
    } else {
      sortCriteria.createdAt = -1; // Default to newest items first
    }

    // Aggregation pipeline to include vendor public profile (name, businessName, subscription badge)
    const pipeline = [
      { $match: query },
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
      { $sort: sortCriteria },
    ];

    // Pagination / Limit handling (e.g. limit=6 for Homepage Featured section)
    const limitNum = parseInt(limit, 10);
    const pageNum = parseInt(page, 10) || 1;

    if (!isNaN(limitNum) && limitNum > 0) {
      const skipNum = (pageNum - 1) * limitNum;
      if (skipNum > 0) {
        pipeline.push({ $skip: skipNum });
      }
      pipeline.push({ $limit: limitNum });
    }

    const items = await collections.menuItems.aggregate(pipeline).toArray();
    const totalCount = await collections.menuItems.countDocuments(query);

    return res.status(200).json({
      success: true,
      count: items.length,
      totalCount,
      items,
    });
  } catch (error) {
    console.error('[Public Get Menu Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch menu items.',
    });
  }
});

/**
 * GET /api/menu/:id
 * Public route to view single approved item details with vendor information
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid menu item ID format.',
      });
    }

    const pipeline = [
      {
        $match: {
          _id: new ObjectId(id),
          status: MENU_STATUS.APPROVED,
        },
      },
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
    ];

    const result = await collections.menuItems.aggregate(pipeline).toArray();

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found or unavailable.',
      });
    }

    return res.status(200).json({
      success: true,
      item: result[0],
    });
  } catch (error) {
    console.error('[Public Single Item Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve menu item details.',
    });
  }
});

export default router;

