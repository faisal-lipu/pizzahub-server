# 🍕 PizzaHub Server — Backend REST API

PizzaHub is a complete, role-based food ordering and delivery platform backend built with **Node.js, Express.js, MongoDB**, and **Stripe**. It provides secure multi-role authorization (Customer, Vendor, Admin), real-time business rule validations, advanced search & sorting, automated subscription billing via Stripe Webhooks, and robust database modeling.

---

## 🌐 Live & Repository Links

- **Live API URL:** `https://pizzahub-server.onrender.com` *(or deployment link)*
- **Client Repository:** [https://github.com/faisal-lipu/PizzaHub-client](https://github.com/faisal-lipu/PizzaHub-client)
- **Server Repository:** [https://github.com/faisal-lipu/PizzaHub-server](https://github.com/faisal-lipu/PizzaHub-server)

---

## 🚀 Key Features & Business Rules

### 1. Multi-Role Authorization & Security
- **Customer:** Browse approved menus, dynamic price sorting, submit orders with delivery date and address, cancel pending orders, view personal order history.
- **Vendor (Restaurant Owner):** Manage restaurant profile, CRUD menu items with ImgBB image uploads, view customer orders and accept/reject them, upgrade to Premium subscription via Stripe.
  - *Free Plan Rule:* Vendors on the Free plan are strictly limited to **maximum 3 active/pending menu items**. Adding more requires an upgrade to Premium.
- **Admin:** Comprehensive platform administration, review and approve/reject/delete submitted menu items, manage users (search, filter, block/unblock), view real-time platform subscription transactions.
  - *Admin Restrictions:* Admins cannot be created via public registration, cannot order food, and cannot alter transaction records.

### 2. Robust Order Validation
- Customers cannot order items from their own vendor profile.
- Duplicate active orders (`pending` or `accepted`) for the same menu item on the same delivery date are strictly prevented.
- Only orders in `pending` status can be accepted/rejected by vendors or cancelled by customers.

### 3. Verified Stripe Webhook Flow
- Vendors upgrade to Premium via Stripe Checkout.
- **Zero Frontend Trust:** Premium subscriptions are activated **only** when a cryptographically verified `checkout.session.completed` webhook event is received directly from Stripe.
- Every payment is recorded in the immutable `transactions` collection.

---

## 🛠️ Technology Stack & Dependencies

| Category | Technology / Package | Purpose |
|---|---|---|
| **Runtime & Framework** | Node.js, Express.js (v5) | High-performance REST API routing and middleware execution |
| **Database** | MongoDB (v7), MongoClient | Document database with native connection pooling and aggregations |
| **Authentication** | JSON Web Tokens (`jsonwebtoken`), Better Auth | Bearer token verification, stateless session management, role verification |
| **Payment Gateway** | Stripe SDK (`stripe`) | Checkout session generation and cryptographic webhook verification |
| **Security & Utilities** | `cors`, `dotenv` | Cross-Origin Resource Sharing control and environment variable safety |
| **Development** | `nodemon` | Hot-reloading server daemon for local development |

---

## 📂 Database Architecture (MongoDB Collections)

As specified in the system design, the database utilizes 4 core business collections with proper references:

1. **`users`**: User identities, roles (`customer`, `vendor`, `admin`), block status (`isBlocked`), restaurant business name, subscription plan (`free`, `premium`), and subscription expiration timestamp.
2. **`menuItems`**: Food item details, vendor reference (`vendorId`), name, category, description, price, location, images, status (`pending`, `approved`, `rejected`, `inactive`), and timestamps.
3. **`orders`**: Customer orders referencing `itemId`, `vendorId`, `customerId`, delivery date, delivery address, special instructions, and status (`pending`, `accepted`, `rejected`, `cancelled`).
4. **`transactions`**: Platform subscription financial records referencing `vendorId`, plan, amount, currency, Stripe session ID, and status (`completed`).

---

## 🏆 Challenge Requirements Implementation Details

### Challenge 1: Advanced Search and Price Sorting
- **Endpoint:** `GET /api/menu`
- **Implementation:**
  - **Search:** Case-insensitive regular expressions matching item names and descriptions (`?search=pepperoni`).
  - **Filtering:** Exact matching by category (`?category=Meat Lovers`) and regex matching by location (`?location=Dhanmondi`).
  - **Price Sorting:** Dynamically accepts query parameters `sortBy=price` and `order=asc` (Low to High) or `order=desc` (High to Low).
  - **MongoDB Aggregation:** Utilizes an aggregation pipeline with `$lookup` to securely join vendor details (business name, rating, premium badge) and filters out non-approved items (`status: 'approved'`).
  - **Pagination / Limits:** Query parameter `?limit=6` supports the homepage featured menu section.

### Challenge 2: JWT Verification & Role-Based Middleware Flow
- **Middlewares:** `verifyToken` (`src/middlewares/verifyToken.js`), `verifyRole` (`src/middlewares/verifyRole.js`)
- **Flow:**
  1. Incoming requests extract `Bearer <token>` from the HTTP `Authorization` header. Missing tokens immediately return **`401 Unauthorized`**.
  2. Tokens are decoded using `jwt.verify`. Expired tokens return `401` with explicit code `TOKEN_EXPIRED`.
  3. The user profile is retrieved from the database to check if `isBlocked: true`. Blocked users are instantly rejected with **`403 Forbidden`** (`USER_BLOCKED`).
  4. Role-specific middlewares (`verifyAdmin`, `verifyVendor`, `verifyCustomer`) ensure users cannot perform actions outside their authorization tier, preventing URL tampering and API manipulation.

### Challenge 3: Professional API Architecture & Error Handling
- Complete separation of concerns: `config/`, `middlewares/`, `models/`, `routes/`, and `utils/`.
- Centralized 404 handler for unknown routes and global error-handling middleware preventing unhandled crashes.
- Raw body parsing for Stripe Webhooks (`express.raw({ type: 'application/json' })`) strictly isolated before standard JSON parsing.

---

## ⚙️ Environment Variables Setup

Create a `.env` file in the root directory based on `.env.example`:

```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.qji0htb.mongodb.net/?retryWrites=true&w=majority
DB_NAME=pizzahub

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=7d

# Client Application URL
CLIENT_URL=http://localhost:3000

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PREMIUM_PRICE_ID=price_...

# Image Hosting API
IMGBB_API_KEY=your_imgbb_api_key_here
```

> **Security Notice:** Never commit `.env` or sensitive API keys to GitHub. The `.gitignore` file is configured to strictly ignore environment files.

---

## 💻 Local Installation & How to Run

1. **Clone the repository:**
   ```bash
   git clone https://github.com/faisal-lipu/PizzaHub-server.git
   cd PizzaHub-server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   # Update MONGODB_URI, JWT_SECRET, and STRIPE_SECRET_KEY in .env
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   The server will start on `http://localhost:5000` with hot-reloading enabled.

5. **Start in production mode:**
   ```bash
   npm start
   ```

---

## 📡 API Endpoints Reference

### 🔐 Authentication (`/api/auth`)
- `POST /api/auth/jwt` — Issue JWT token after Better Auth / Google OAuth sign-in.
- `GET /api/auth/me` — Retrieve authenticated user profile `[Protected]`.
- `PATCH /api/auth/profile` — Update user name, image, or restaurant name `[Protected]`.

### 👥 User Administration (`/api/users`)
- `GET /api/users` — List registered users with search, role, and block filters `[Admin]`.
- `GET /api/users/stats` — Aggregated user statistics (vendors, customers, admins) `[Admin]`.
- `PATCH /api/users/:id/block` — Block or unblock a user `[Admin]`.

### 🍕 Menu Items (`/api/menu`)
- `GET /api/menu` — Public menu catalog with search, category/location filters, and price sorting.
- `GET /api/menu/:id` — Public single menu item details with vendor information.
- `POST /api/menu` — Add new menu item with free-tier limit check (max 3 items) `[Vendor]`.
- `GET /api/menu/my-items` — Retrieve vendor's own menu items `[Vendor]`.
- `GET /api/menu/my-items/:id` — Get vendor's single menu item for editing `[Vendor]`.
- `PATCH /api/menu/my-items/:id` — Update menu item details or toggle status `[Vendor]`.
- `DELETE /api/menu/my-items/:id` — Delete menu item `[Vendor]`.
- `GET /api/menu/admin/all` — List all submitted items across all vendors `[Admin]`.
- `GET /api/menu/admin/stats` — Aggregated menu statistics `[Admin]`.
- `PATCH /api/menu/admin/:id/status` — Approve, reject, or update item status `[Admin]`.
- `DELETE /api/menu/admin/:id` — Delete inappropriate menu item `[Admin]`.

### 📦 Orders (`/api/orders`)
- `POST /api/orders` — Place customer order with duplicate active order prevention `[Customer]`.
- `GET /api/orders/my-orders` — Customer order history `[Customer]`.
- `GET /api/orders/my-orders/stats` — Customer order status counts `[Customer]`.
- `PATCH /api/orders/my-orders/:id/cancel` — Cancel pending customer order `[Customer]`.
- `GET /api/orders/vendor` — Incoming customer orders for vendor `[Vendor]`.
- `GET /api/orders/vendor/stats` — Vendor incoming order statistics `[Vendor]`.
- `PATCH /api/orders/vendor/:id/action` — Accept or reject pending customer order `[Vendor]`.

### 💳 Payments & Subscriptions (`/api/payment` & `/api/transactions`)
- `POST /api/payment/create-checkout-session` — Create Stripe Checkout session for vendor upgrade `[Vendor]`.
- `GET /api/payment/subscription-status` — Vendor subscription status and recent payments `[Vendor]`.
- `POST /api/payment/webhook` — Stripe webhook listener for cryptographic event verification.
- `GET /api/transactions` — View all platform subscription transactions `[Admin (Read-Only)]`.
- `GET /api/transactions/stats` — Aggregated platform transaction volume and revenue stats `[Admin]`.

---

## 📄 License
This project is developed for educational and portfolio purposes as part of the Assignment-9 curriculum.
