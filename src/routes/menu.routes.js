import express from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { verifyVendor } from '../middlewares/verifyRole.js';
import {
  MENU_CATEGORIES,
  MENU_STATUS,
  SUBSCRIPTION_PLANS,
  formatMenuItemDocument,
} from '../models/schemas.js';

const router = express.Router();

/**
 * POST /api/menu
 * ভেন্ডরের নতুন মেনু আইটেম যোগ করা (ফ্রি টায়ারে সর্বোচ্চ ৩টি আইটেম লিমিট চেকিং সহ)
 */
router.post('/', verifyToken, verifyVendor, async (req, res) => {
  try {
    const { itemName, category, description, price, location, images, image } = req.body;

    // প্রয়োজনীয় ফিল্ডগুলো চেক করা
    if (!itemName || !category || price === undefined || !location) {
      return res.status(400).json({
        success: false,
        message: 'Item name, category, price, and location are required.',
      });
    }

    // ক্যাটাগরি ভ্যালিড কিনা চেক করা
    if (!MENU_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Allowed categories are: ${MENU_CATEGORIES.join(', ')}`,
      });
    }

    // ইমেজ চেক করা (ImgBB থেকে প্রাপ্ত লিংক)
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

    // ভেন্ডরের বর্তমান ডাটাবেজ তথ্য ও সাবস্ক্রিপশন প্ল্যান চেক করা
    const vendor = await collections.users.findOne({ _id: new ObjectId(req.user._id) });
    const isPremium = vendor?.subscriptionPlan === SUBSCRIPTION_PLANS.PREMIUM;

    // ফ্রি প্ল্যানের নিয়ম: সর্বোচ্চ ৩টি আইটেম (রিজেক্টেড আইটেম ছাড়া পেন্ডিং ও অ্যাপ্রুভড আইটেম গুনে দেখা)
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

    // নতুন মেনু আইটেম তৈরি করা (ডিফল্ট স্ট্যাটাস: pending)
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
 * ভেন্ডরের নিজস্ব সমস্ত মেনু আইটেমের তালিকা দেখা
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
 * নির্দিষ্ট একটি মেনু আইটেমের বিস্তারিত দেখা (শুধুমাত্র ওনার ভেন্ডর দেখতে পারবে)
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
      vendorId: req.user._id, // ওনারশিপ ভেরিফিকেশন
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
 * মেনু আইটেম আপডেট করা অথবা স্ট্যাটাস পরিবর্তন করা
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

    // ওনারশিপ চেক: আইটেমটি এই ভেন্ডরের কিনা
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

    // ভেন্ডর কেবল inactive অথবা তার অ্যাপ্রুভড আইটেমকে রিস্টোর করতে পারবে
    if (status !== undefined) {
      if ([MENU_STATUS.INACTIVE, MENU_STATUS.APPROVED].includes(status)) {
        updateDoc.status = status;
      }
    } else if (Object.keys(updateDoc).length > 0) {
      // যদি ইনফরমেশন আপডেট করা হয়, তবে নিরাপত্তার জন্য অ্যাডমিন রিভিউতে পাঠাবে (pending)
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
 * মেনু আইটেম ডিলিট করা
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

    // ওনারশিপ চেক
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

export default router;
