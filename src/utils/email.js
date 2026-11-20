import nodemailer from 'nodemailer';
import { collections } from '../config/db.js';

let transporterPromise = null;

/**
 * Initializes or retrieves the nodemailer transporter
 */
async function getTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Fallback: create ethereal test account or simulated logger
  if (!transporterPromise) {
    transporterPromise = (async () => {
      try {
        const testAccount = await nodemailer.createTestAccount();
        console.log('[Email Service] Created Ethereal test email account:', testAccount.user);
        return nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
      } catch (err) {
        console.warn('[Email Service] Ethereal creation failed, using mock transporter:', err.message);
        return nodemailer.createTransport({
          jsonTransport: true,
        });
      }
    })();
  }

  return transporterPromise;
}

/**
 * Generates an HTML email for Order Accepted or Rejected notification
 */
function generateOrderEmailHtml({
  customerName,
  orderId,
  pizzaName,
  pizzaPrice,
  status,
  vendorName,
  deliveryAddress,
  deliveryDate,
}) {
  const isAccepted = status === 'accepted';
  const brandRed = '#D91E18';
  const statusColor = isAccepted ? '#10B981' : '#EF4444';
  const statusBg = isAccepted ? '#ECFDF5' : '#FEF2F2';
  const statusBorder = isAccepted ? '#A7F3D0' : '#FECACA';
  const statusTitle = isAccepted
    ? '🎉 Order Accepted! Your Pizza is in the Works'
    : 'Order Update: Kitchen Unable to Fulfill Request';
  const statusMessage = isAccepted
    ? `Great news! <strong>${vendorName}</strong> has reviewed and accepted your pizza order. The kitchen is firing up the woodfired oven at 450°C to prepare your artisanal pizza fresh.`
    : `We are sorry to inform you that <strong>${vendorName}</strong> is unable to fulfill your order for the requested time slot. No charges have been made. You can browse our other vetted artisan kitchens on PizzaHub.`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${statusTitle}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #FAF8F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1C1917;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #FAF8F5; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" max-width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #FFFFFF; border-radius: 24px; border: 1px solid #E7E5E4; box-shadow: 0 4px 12px rgba(0,0,0,0.04); overflow: hidden;">
          
          <!-- Header Bar -->
          <tr>
            <td style="background-color: #1C1917; padding: 24px 32px; text-align: left;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 22px; font-weight: 900; color: #FFFFFF; letter-spacing: -0.5px;">
                      PIZZA<span style="color: ${brandRed};">HUB</span>
                    </span>
                  </td>
                  <td align="right">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #A8A29E; background: #292524; padding: 4px 12px; border-radius: 9999px;">
                      Order Notification
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Status Banner -->
          <tr>
            <td style="padding: 32px 32px 16px 32px;">
              <div style="background-color: ${statusBg}; border: 1px solid ${statusBorder}; border-radius: 16px; padding: 20px; text-align: left;">
                <p style="margin: 0 0 6px 0; font-size: 16px; font-weight: 800; color: ${statusColor};">
                  ${statusTitle}
                </p>
                <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #44403C;">
                  ${statusMessage}
                </p>
              </div>
            </td>
          </tr>

          <!-- Order Summary Details -->
          <tr>
            <td style="padding: 16px 32px 24px 32px;">
              <p style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #A8A29E; margin: 0 0 12px 0;">
                Order Summary & Details
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F5F5F4; border-radius: 16px; padding: 18px;">
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #78716C;">Order Reference:</td>
                  <td align="right" style="padding: 6px 0; font-size: 13px; font-weight: 700; color: #1C1917; font-family: monospace;">
                    #${String(orderId).slice(-8).toUpperCase()}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #78716C;">Menu Item:</td>
                  <td align="right" style="padding: 6px 0; font-size: 13px; font-weight: 800; color: #1C1917;">
                    ${pizzaName}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #78716C;">Total Price:</td>
                  <td align="right" style="padding: 6px 0; font-size: 14px; font-weight: 900; color: ${brandRed};">
                    $${Number(pizzaPrice).toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #78716C;">Pizzeria Kitchen:</td>
                  <td align="right" style="padding: 6px 0; font-size: 13px; font-weight: 700; color: #1C1917;">
                    ${vendorName}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #78716C;">Delivery Date:</td>
                  <td align="right" style="padding: 6px 0; font-size: 13px; font-weight: 600; color: #44403C;">
                    ${deliveryDate ? new Date(deliveryDate).toLocaleDateString() : 'Scheduled Date'}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #78716C;">Delivery Address:</td>
                  <td align="right" style="padding: 6px 0; font-size: 12px; font-weight: 500; color: #44403C; max-width: 240px;">
                    ${deliveryAddress || 'Standard Address'}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Call to action button -->
          <tr>
            <td align="center" style="padding: 0 32px 32px 32px;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/dashboard/customer?tab=orders" style="display: inline-block; background-color: ${brandRed}; color: #FFFFFF; font-size: 13px; font-weight: 800; text-decoration: none; padding: 14px 28px; border-radius: 9999px; box-shadow: 0 4px 10px rgba(217, 30, 24, 0.25);">
                Track Live Order in Dashboard
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #F5F5F4; padding: 20px 32px; text-align: center; border-top: 1px solid #E7E5E4;">
              <p style="margin: 0; font-size: 11px; color: #A8A29E; line-height: 1.4;">
                This is an automated notification from PizzaHub Platform.<br>
                Need help? Contact support@pizzahub.com.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends an email notification to the customer when their order is accepted or rejected
 */
export async function sendOrderNotificationEmail({
  customerId,
  customerEmail,
  customerName = 'Customer',
  orderId,
  pizzaName = 'Artisan Pizza',
  pizzaPrice = 14.99,
  status, // 'accepted' | 'rejected'
  vendorName = 'Artisan Kitchen',
  deliveryAddress = '',
  deliveryDate = '',
}) {
  if (!customerEmail) {
    console.warn('[Email Service] Skipping email notification: No customer email provided.');
    return { success: false, reason: 'missing_email' };
  }

  const isAccepted = status === 'accepted';
  const subject = isAccepted
    ? `🎉 Your PizzaHub Order #${String(orderId).slice(-6).toUpperCase()} has been Accepted by ${vendorName}`
    : `Order Update: PizzaHub Order #${String(orderId).slice(-6).toUpperCase()} was Declined`;

  const html = generateOrderEmailHtml({
    customerName,
    orderId,
    pizzaName,
    pizzaPrice,
    status,
    vendorName,
    deliveryAddress,
    deliveryDate,
  });

  try {
    const transporter = await getTransporter();

    const info = await transporter.sendMail({
      from: `"PizzaHub Kitchen" <no-reply@pizzahub.com>`,
      to: customerEmail,
      subject,
      html,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) || null;

    console.log(`[Email Service] Order ${status} email sent to ${customerEmail}`);
    if (previewUrl) {
      console.log(`[Email Service] Ethereal Preview URL: ${previewUrl}`);
    }

    // Persist to notifications collection in database
    if (collections?.notifications) {
      await collections.notifications.insertOne({
        customerId: String(customerId),
        customerEmail,
        orderId: String(orderId),
        status,
        subject,
        previewUrl,
        pizzaName,
        vendorName,
        createdAt: new Date(),
        read: false,
      });
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl,
      recipient: customerEmail,
      status,
    };
  } catch (error) {
    console.error('[Email Service Error]: Failed to send notification email:', error.message);
    return { success: false, error: error.message };
  }
}
