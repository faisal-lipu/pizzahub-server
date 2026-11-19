import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI || 'mongodb+srv://pizzhub-admin:SAnnzBpBcf7w3Z7Z@cluster0.qji0htb.mongodb.net/';
const dbName = process.env.DB_NAME || 'pizzahub';

async function seedDatabase() {
  console.log('[Seed] Connecting to MongoDB Atlas...');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // 1. Ensure Vendor exists
  let vendor = await db.collection('users').findOne({ role: 'vendor' });
  if (!vendor) {
    const res = await db.collection('users').insertOne({
      name: 'Mario Rossi',
      email: 'vendor@pizzahub.com',
      image: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=400&auto=format&fit=crop&q=80',
      role: 'vendor',
      isBlocked: false,
      businessName: 'Artisan Napoli Pizza Co.',
      subscriptionPlan: 'premium',
      subscriptionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    });
    vendor = await db.collection('users').findOne({ _id: res.insertedId });
    console.log('[Seed] Created default vendor:', vendor._id.toString());
  } else {
    console.log('[Seed] Found existing vendor:', vendor._id.toString());
  }

  // 2. Ensure Admin exists
  let admin = await db.collection('users').findOne({ role: 'admin' });
  if (!admin) {
    const adminRes = await db.collection('users').insertOne({
      name: 'System Admin',
      email: 'admin@pizzahub.com',
      image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
      role: 'admin',
      isBlocked: false,
      businessName: null,
      subscriptionPlan: 'free',
      subscriptionExpiresAt: null,
      createdAt: new Date(),
    });
    console.log('[Seed] Created default admin:', adminRes.insertedId.toString());
  } else {
    console.log('[Seed] Found existing admin:', admin._id.toString());
  }

  // 3. Insert 6 authentic pizzas with status 'approved'
  const pizzas = [
    {
      vendorId: vendor._id,
      itemName: 'Classic Pepperoni Supreme',
      name: 'Classic Pepperoni Supreme',
      category: 'Pepperoni',
      description: 'Crispy beef pepperoni, rich San Marzano tomato sauce, double mozzarella cheese, and fragrant fresh oregano.',
      price: 14.99,
      location: 'Little Italy, New York',
      images: ['https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&auto=format&fit=crop&q=80'],
      image: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&auto=format&fit=crop&q=80',
      rating: 4.9,
      preparationTime: 15,
      ingredients: ['Slow-fermented dough', 'San Marzano tomatoes', 'Beef Pepperoni', 'Whole-milk Mozzarella', 'Oregano'],
      status: 'approved',
      createdAt: new Date(),
    },
    {
      vendorId: vendor._id,
      itemName: 'Tuscan Margherita D.O.C.',
      name: 'Tuscan Margherita D.O.C.',
      category: 'Veggie',
      description: 'Authentic buffalo mozzarella, sweet cherry tomatoes, extra virgin olive oil, and fresh garden basil on woodfired crust.',
      price: 12.50,
      location: 'Brooklyn, New York',
      images: ['https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=800&auto=format&fit=crop&q=80'],
      image: 'https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=800&auto=format&fit=crop&q=80',
      rating: 4.8,
      preparationTime: 12,
      ingredients: ['Sourdough crust', 'Buffalo Mozzarella', 'Cherry Tomatoes', 'Fresh Basil', 'EV Olive Oil'],
      status: 'approved',
      createdAt: new Date(Date.now() - 3600000),
    },
    {
      vendorId: vendor._id,
      itemName: 'Smokey BBQ Chicken Feast',
      name: 'Smokey BBQ Chicken Feast',
      category: 'Chicken',
      description: 'Tender roasted chicken strips, hickory BBQ glaze, caramelized red onions, smoked gouda, and fresh cilantro.',
      price: 16.20,
      location: 'Downtown, Queens',
      images: ['https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&auto=format&fit=crop&q=80'],
      image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&auto=format&fit=crop&q=80',
      rating: 4.9,
      preparationTime: 18,
      ingredients: ['Hickory BBQ Glaze', 'Roasted Chicken', 'Caramelized Onions', 'Smoked Gouda', 'Cilantro'],
      status: 'approved',
      createdAt: new Date(Date.now() - 7200000),
    },
    {
      vendorId: vendor._id,
      itemName: 'Quattro Formaggi Deluxe',
      name: 'Quattro Formaggi Deluxe',
      category: 'Cheese',
      description: 'A velvety four-cheese blend of aged gorgonzola, shaved parmesan, Italian fontina, and melted fresh mozzarella.',
      price: 15.00,
      location: 'Midtown, Manhattan',
      images: ['https://images.unsplash.com/photo-1573821663912-569905455b1c?w=800&auto=format&fit=crop&q=80'],
      image: 'https://images.unsplash.com/photo-1573821663912-569905455b1c?w=800&auto=format&fit=crop&q=80',
      rating: 4.7,
      preparationTime: 14,
      ingredients: ['Gorgonzola', 'Parmigiano Reggiano', 'Fontina', 'Fior di Latte Mozzarella', 'Wild Honey Drizzle'],
      status: 'approved',
      createdAt: new Date(Date.now() - 10800000),
    },
    {
      vendorId: vendor._id,
      itemName: 'Truffle Mushroom Special',
      name: 'Truffle Mushroom Special',
      category: 'Special',
      description: 'Wild portobello and sautéed button mushrooms infused with fragrant Piedmont white truffle oil and fresh thyme.',
      price: 17.50,
      location: 'SoHo, New York',
      images: ['https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop&q=80'],
      image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop&q=80',
      rating: 5.0,
      preparationTime: 15,
      ingredients: ['Portobello Mushrooms', 'White Truffle Oil', 'Fresh Thyme', 'Ricotta Salata', 'Garlic Cream'],
      status: 'approved',
      createdAt: new Date(Date.now() - 14400000),
    },
    {
      vendorId: vendor._id,
      itemName: 'Spicy Diavola & Jalapeno',
      name: 'Spicy Diavola & Jalapeno',
      category: 'Pepperoni',
      description: 'Calabrian hot soppressata, pickled jalapeno peppers, spicy tomato reduction, and chili-infused wildflower honey.',
      price: 15.80,
      location: 'Williamsburg, Brooklyn',
      images: ['https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=800&auto=format&fit=crop&q=80'],
      image: 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=800&auto=format&fit=crop&q=80',
      rating: 4.8,
      preparationTime: 15,
      ingredients: ['Calabrian Soppressata', 'Pickled Jalapenos', 'Hot Honey', 'Red Chili Flakes', 'Mozzarella'],
      status: 'approved',
      createdAt: new Date(Date.now() - 18000000),
    },
  ];

  await db.collection('menuItems').deleteMany({});
  const insertResult = await db.collection('menuItems').insertMany(pizzas);
  console.log(`[Seed] Successfully inserted ${insertResult.insertedCount} artisan pizzas into MongoDB Atlas!`);

  const sampleItems = await db.collection('menuItems').find({}, { projection: { itemName: 1, price: 1, status: 1 } }).toArray();
  console.log('[Seed] Sample menu items:', sampleItems);

  await client.close();
  console.log('[Seed] Done!');
}

seedDatabase().catch((err) => {
  console.error('[Seed Error]:', err);
  process.exit(1);
});
