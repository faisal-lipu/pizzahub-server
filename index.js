import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { connectDB } from './src/config/db.js';
import authRoutes from './src/routes/auth.routes.js';
import userRoutes from './src/routes/user.routes.js';
import menuRoutes from './src/routes/menu.routes.js';
import orderRoutes from './src/routes/order.routes.js';
import paymentRoutes, { handleStripeWebhook } from './src/routes/payment.routes.js';

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors({
  origin: [
    'http://localhost:3000',
    process.env.CLIENT_URL
  ].filter(Boolean),
  credentials: true
}));

// Stripe Webhook must receive raw body buffer before express.json() parser
app.post(
  '/api/payment/webhook',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);

// Root health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'PizzaHub Server is up and running!',
    timestamp: new Date().toISOString()
  });
});

// 404 handler for unknown API routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

async function startServer() {
  try {
    if (process.env.MONGODB_URI) {
      await connectDB();
    } else {
      console.warn('[Notice] MONGODB_URI not set yet. Server will start without immediate DB connection.');
    }
  } catch (err) {
    console.error('[Error] Failed to connect to MongoDB on start:', err.message);
  }

  app.listen(port, () => {
    console.log(`[PizzaHub Server] Running on http://localhost:${port}`);
  });
}

startServer();

export default app;
