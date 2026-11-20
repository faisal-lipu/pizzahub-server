import express from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { verifyVendor } from '../middlewares/verifyRole.js';
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

/* ==========================================================================
   VENDOR ORDER MANAGEMENT ROUTES (Protected by verifyVendor)
   ========================================================================== */

/**
 * GET /api/orders/vendor
 * Retrieve incoming customer orders for the authenticated vendor
 * Query params: ?status=pending
 */
router.get(['/vendor', '/vendor/orders'], verifyToken, verifyVendor, async (req, res) => {
  try {
    const { status } = req.query;
    const vendorId = req.user._id;

    const matchConditions = [
      {
        $or: [
          { vendorId: vendorId },
          { vendorId: new ObjectId(vendorId) },
        ],
      },
    ];

    if (status && Object.values(ORDER_STATUS).includes(status.toLowerCase())) {
      matchConditions.push({ status: status.toLowerCase() });
    }

    const pipeline = [
      { $match: { $and: matchConditions } },
      // Lookup customer information
      {
        $lookup: {
          from: 'users',
          let: { cId: '$customerId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: [{ $toString: '$_id' }, '$$cId'] },
                    { $eq: ['$_id', '$$cId'] },
                  ],
                },
              },
            },
            {
              $project: {
                name: 1,
                email: 1,
                image: 1,
              },
            },
          ],
          as: 'customer',
        },
      },
      {
        $unwind: {
          path: '$customer',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Lookup ordered menu item details
      {
        $lookup: {
          from: 'menuItems',
          let: { itmId: '$itemId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: [{ $toString: '$_id' }, '$$itmId'] },
                    { $eq: ['$_id', '$$itmId'] },
                  ],
                },
              },
            },
            {
              $project: {
                itemName: 1,
                category: 1,
                price: 1,
                images: 1,
                location: 1,
              },
            },
          ],
          as: 'menuItem',
        },
      },
      {
        $unwind: {
          path: '$menuItem',
          preserveNullAndEmptyArrays: true,
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    const orders = await collections.orders.aggregate(pipeline).toArray();

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error('[Vendor Get Orders Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch customer orders.',
    });
  }
});

/**
 * GET /api/orders/vendor/stats
 * Aggregated order stats for Vendor Dashboard overview
 */
router.get('/vendor/stats', verifyToken, verifyVendor, async (req, res) => {
  try {
    const vendorId = req.user._id;
    const vendorMatch = {
      $or: [
        { vendorId: vendorId },
        { vendorId: new ObjectId(vendorId) },
      ],
    };

    const [totalOrders, pendingOrders, acceptedOrders, rejectedOrders] = await Promise.all([
      collections.orders.countDocuments(vendorMatch),
      collections.orders.countDocuments({ ...vendorMatch, status: ORDER_STATUS.PENDING }),
      collections.orders.countDocuments({ ...vendorMatch, status: ORDER_STATUS.ACCEPTED }),
      collections.orders.countDocuments({ ...vendorMatch, status: ORDER_STATUS.REJECTED }),
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalOrders,
        pendingOrders,
        acceptedOrders,
        rejectedOrders,
      },
    });
  } catch (error) {
    console.error('[Vendor Order Stats Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load vendor order statistics.',
    });
  }
});

/**
 * PATCH /api/orders/vendor/:id/action
 * Accept or Reject incoming customer order
 * Rule: Only pending orders can be accepted or rejected, and only once
 * Body: { "action": "accept" } or { "action": "reject" }
 */
router.patch(['/vendor/:id/action', '/:id/:action', '/vendor/:id/:action'], verifyToken, verifyVendor, async (req, res) => {
  try {
    const { id, action: paramAction } = req.params;
    const { action: bodyAction, status } = req.body || {};

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID format.',
      });
    }

    // Determine target action status from param or body
    const requestedAction = (paramAction || bodyAction || status || '').toLowerCase();
    let targetStatus;

    if (requestedAction === 'accept' || requestedAction === ORDER_STATUS.ACCEPTED) {
      targetStatus = ORDER_STATUS.ACCEPTED;
    } else if (requestedAction === 'reject' || requestedAction === ORDER_STATUS.REJECTED) {
      targetStatus = ORDER_STATUS.REJECTED;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Allowed actions are 'accept' or 'reject'.",
      });
    }

    // Fetch order and verify ownership
    const order = await collections.orders.findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    // Ownership check: Vendor cannot modify orders belonging to other vendors
    if (order.vendorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized. You cannot modify orders belonging to another vendor.',
      });
    }

    // Rule: Only pending orders can be accepted or rejected, and only once
    if (order.status !== ORDER_STATUS.PENDING) {
      return res.status(400).json({
        success: false,
        code: 'ORDER_ALREADY_PROCESSED',
        message: `This order is already '${order.status}'. Only pending orders can be accepted or rejected.`,
      });
    }

    // Update status
    await collections.orders.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: targetStatus,
          updatedAt: new Date(),
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: `Order successfully ${targetStatus}.`,
      orderId: id,
      newStatus: targetStatus,
    });
  } catch (error) {
    console.error('[Vendor Order Action Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update order status.',
    });
  }
});

/* ==========================================================================
   CUSTOMER ORDER ROUTES (Protected by verifyToken)
   ========================================================================== */

/**
 * GET /api/orders/my-orders
 * Retrieve order history for the authenticated customer
 * Query params: ?status=pending
 */
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    const customerId = req.user._id;

    const matchConditions = [
      {
        $or: [
          { customerId: customerId },
          { customerId: new ObjectId(customerId) },
        ],
      },
    ];

    if (status && Object.values(ORDER_STATUS).includes(status.toLowerCase())) {
      matchConditions.push({ status: status.toLowerCase() });
    }

    const pipeline = [
      { $match: { $and: matchConditions } },
      // Lookup menu item details
      {
        $lookup: {
          from: 'menuItems',
          let: { itmId: '$itemId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: [{ $toString: '$_id' }, '$$itmId'] },
                    { $eq: ['$_id', '$$itmId'] },
                  ],
                },
              },
            },
            {
              $project: {
                itemName: 1,
                category: 1,
                price: 1,
                images: 1,
                location: 1,
              },
            },
          ],
          as: 'menuItem',
        },
      },
      {
        $unwind: {
          path: '$menuItem',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Lookup vendor details
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
                businessName: 1,
                email: 1,
                image: 1,
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

    const orders = await collections.orders.aggregate(pipeline).toArray();

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error('[Customer Get Orders Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch your orders.',
    });
  }
});

/**
 * GET /api/orders/my-orders/stats
 * Aggregated order stats for Customer Dashboard overview
 */
router.get('/my-orders/stats', verifyToken, async (req, res) => {
  try {
    const customerId = req.user._id;
    const customerMatch = {
      $or: [
        { customerId: customerId },
        { customerId: new ObjectId(customerId) },
      ],
    };

    const [totalOrders, pendingOrders, acceptedOrders, rejectedOrders, cancelledOrders] =
      await Promise.all([
        collections.orders.countDocuments(customerMatch),
        collections.orders.countDocuments({ ...customerMatch, status: ORDER_STATUS.PENDING }),
        collections.orders.countDocuments({ ...customerMatch, status: ORDER_STATUS.ACCEPTED }),
        collections.orders.countDocuments({ ...customerMatch, status: ORDER_STATUS.REJECTED }),
        collections.orders.countDocuments({ ...customerMatch, status: ORDER_STATUS.CANCELLED }),
      ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalOrders,
        pendingOrders,
        acceptedOrders,
        rejectedOrders,
        cancelledOrders,
      },
    });
  } catch (error) {
    console.error('[Customer Order Stats Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load order statistics.',
    });
  }
});

/**
 * PATCH /api/orders/my-orders/:id/cancel
 * Cancel a pending order by customer
 * Rule: Only pending orders can be cancelled; accepted, rejected, or already cancelled orders cannot be cancelled
 */
router.patch('/my-orders/:id/cancel', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID format.',
      });
    }

    const order = await collections.orders.findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    // Ownership check: Customers cannot change or cancel another customer's order
    if (order.customerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized. You can only cancel your own orders.',
      });
    }

    // Rule: Cannot cancel an order that is already accepted, rejected, or cancelled
    if (order.status !== ORDER_STATUS.PENDING) {
      return res.status(400).json({
        success: false,
        code: 'CANNOT_CANCEL_ORDER',
        message: `Order cannot be cancelled because its current status is '${order.status}'. Only pending orders can be cancelled.`,
      });
    }

    // Update status to cancelled
    await collections.orders.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: ORDER_STATUS.CANCELLED,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Order has been successfully cancelled.',
      orderId: id,
      newStatus: ORDER_STATUS.CANCELLED,
    });
  } catch (error) {
    console.error('[Cancel Order Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel order.',
    });
  }
});

export default router;
