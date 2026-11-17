import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { connectDB } from './src/config/db.js';

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
app.use(express.json());

// Root health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'PizzaHub Server is up and running!',
    timestamp: new Date().toISOString()
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
