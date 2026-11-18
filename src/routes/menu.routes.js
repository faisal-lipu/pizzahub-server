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
    const { itemName, category, description, price, location, images, image } = req.body;

    // Validate required fields
    if (!itemName || !category || price === undefined || !location) {
      return res.status(400).json({
        success: false,
        message: 'Item name, category, price, and location are required.',
      });
    }

    // Validate category
    if (!MENU_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Allowed categories are: ${MENU_CATEGORIES.join(', ')}`,
      });
    }

    // Validate image URL (ImgBB)
    const finalImages = Array.isArray(images) && images.length > 0
      ? images
      : image
      ? [image]
      : [];

    if (finalImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one menu item image is required (ImgBB URL).',
      });
    }

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
      { itemName, category, description, price, location, images: finalImages },
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
 * GET /api/menu/my-items
 * Fetch all menu items belonging to the authenticated vendor
 */
router.get('/my-items', verifyToken, verifyVendor, async (req, res) => {
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
router.delete('/my-items/:id', verifyToken, verifyVendor, async (req, res) => {
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

export default router;

