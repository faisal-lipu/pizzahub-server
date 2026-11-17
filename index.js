import 'dotenv/config';
import express from 'express';
import cors from 'cors';

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

app.listen(port, () => {
  console.log(`[PizzaHub Server] Running on http://localhost:${port}`);
});

export default app;
