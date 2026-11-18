import express from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import {
  ORDER_STATUS,
  MENU_STATUS,
  ROLES,
  formatOrderDocument,
} from '../models/schemas.js';

const router = express.Router();

/**
 * POST /api/orders
 * Create a new customer order for an approved menu item
 * Enforces duplicate active order prevention and role ownership restrictions
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    const { itemId, deliveryDate, deliveryAddress, message } = req.body;

    // Rule: Admins cannot place customer orders
    if (req.user.role === ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Administrators cannot place food orders.',
      });
    }

    // Validate required fields
    if (!itemId || !deliveryDate || !deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: 'Menu item ID, delivery date, and delivery address are required.',
      });
    }

    if (!ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid menu item ID format.',
      });
    }

    // Verify menu item exists and is currently approved
    const menuItem = await collections.menuItems.findOne({
      _id: new ObjectId(itemId),
      status: MENU_STATUS.APPROVED,
    });

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found or is currently not available for ordering.',
      });
    }

    // Rule: Vendors cannot order their own items
    const vendorIdStr = menuItem.vendorId.toString();
    if (req.user._id.toString() === vendorIdStr) {
      return res.status(403).json({
        success: false,
        message: 'Vendors cannot place orders for their own menu items.',
      });
    }

    // Normalize delivery date string (YYYY-MM-DD)
    const normalizedDeliveryDate = new Date(deliveryDate).toISOString().split('T')[0];

    // Rule: Prevent duplicate active orders for the same item and delivery date
    const duplicateOrder = await collections.orders.findOne({
      customerId: req.user._id,
      $or: [
        { itemId: menuItem._id.toString() },
        { itemId: menuItem._id },
      ],
      deliveryDate: normalizedDeliveryDate,
      status: { $in: [ORDER_STATUS.PENDING, ORDER_STATUS.ACCEPTED] },
    });

    if (duplicateOrder) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_ACTIVE_ORDER',
        message: `You already have an active order (${duplicateOrder.status}) for this item on ${normalizedDeliveryDate}.`,
      });
    }

    // Format new order document
    const newOrder = formatOrderDocument({
      itemId: menuItem._id.toString(),
      vendorId: vendorIdStr,
      customerId: req.user._id,
      deliveryDate: normalizedDeliveryDate,
      deliveryAddress,
      message,
    });

    const result = await collections.orders.insertOne(newOrder);

    return res.status(201).json({
      success: true,
      message: 'Order placed successfully! Waiting for vendor confirmation.',
      order: {
        _id: result.insertedId,
        itemName: menuItem.itemName,
        price: menuItem.price,
        ...newOrder,
      },
    });
  } catch (error) {
    console.error('[Create Order Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to place order.',
    });
  }
});

export default router;
