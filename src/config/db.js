import { MongoClient, ServerApiVersion } from 'mongodb';
import 'dotenv/config';

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'pizzahub';

if (!uri) {
  console.warn('[Warning] MONGODB_URI is not defined in environment variables.');
}

const client = new MongoClient(uri || 'mongodb://localhost:27017', {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let dbInstance = null;

export async function connectDB() {
  if (dbInstance) return dbInstance;
  try {
    await client.connect();
    dbInstance = client.db(dbName);
    console.log(`[MongoDB] Connected successfully to database: "${dbName}"`);
    return dbInstance;
  } catch (error) {
    console.error('[MongoDB] Connection error:', error.message);
    throw error;
  }
}

export function getDB() {
  if (!dbInstance) {
    dbInstance = client.db(dbName);
  }
  return dbInstance;
}

// Collections helper getters as per assignment requirements
export const collections = {
  get users() {
    return getDB().collection('users');
  },
  get menuItems() {
    return getDB().collection('menuItems');
  },
  get orders() {
    return getDB().collection('orders');
  },
  get transactions() {
    return getDB().collection('transactions');
  },
  get mockCheckoutSessions() {
    return getDB().collection('mockCheckoutSessions');
  }
};

export async function closeDB() {
  await client.close();
  console.log('[MongoDB] Connection closed.');
}
