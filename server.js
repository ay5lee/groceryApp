require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = (process.env.BASE_PATH || '/grocerymate').replace(/\/+$/, '');

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
if (BASE_PATH) {
  app.use(BASE_PATH, express.static('public'));
}

app.set('view engine', 'ejs');
app.locals.basePath = BASE_PATH;

async function ensureSchemaCompat() {
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'transactions'
      ) THEN
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS receipt_url TEXT;
      END IF;
    END $$;
  `);
}

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const CASH_ALIASES = new Set(['given', 'cash']);

// WA-Gateway config
const WA_GATEWAY_URL = (process.env.WA_GATEWAY_URL || '').replace(/\/+$/, '');
const WA_GATEWAY_TOKEN = process.env.WA_GATEWAY_TOKEN || '';
const WA_GROUP_JID = process.env.WA_GROUP_JID || '';
const APP_INTERNAL_URL = (process.env.APP_INTERNAL_URL || '').replace(/\/+$/, '');
const RECEIPTS_DIR = path.join(__dirname, 'uploads', 'receipts');

fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const receiptStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RECEIPTS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg') || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext.toLowerCase()}`);
  }
});

const uploadReceipt = multer({
  storage: receiptStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  }
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

const route = (method, path, ...handlers) => {
  app[method](path, ...handlers);
  if (BASE_PATH) {
    const prefixedPath = path === '/' ? `${BASE_PATH}/` : `${BASE_PATH}${path}`;
    app[method](prefixedPath, ...handlers);
  }
};

// Routes
route('get', '/', (req, res) => {
  res.render('login');
});

// Serve receipt images — authenticated only, token stays in header not URL
route('get', '/api/receipts/:filename', authenticateToken, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(RECEIPTS_DIR, filename);
  if (!filePath.startsWith(RECEIPTS_DIR)) return res.status(400).send('Invalid path');
  res.sendFile(filePath, err => {
    if (err) res.status(404).send('Receipt not found');
  });
});

route('get', '/dashboard', (req, res) => {
  res.render('dashboard');
});

// Login
route('post', '/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ token, role: user.role, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get transactions
route('get', '/api/transactions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, tt.category 
      FROM transactions t
      LEFT JOIN transaction_types tt ON t.type = tt.name
      ORDER BY t.datetime ASC
    `);
    let balance = 0;
    const transactions = result.rows.map(t => {
      if (CASH_ALIASES.has(t.type) || t.category === 'credit') balance += parseFloat(t.amount);
      else balance -= parseFloat(t.amount);
      return { ...t, balance: balance.toFixed(2) };
    });
    // Reverse to show latest first while keeping correct balance values
    res.json(transactions.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add transaction
route('post', '/api/transactions', authenticateToken, uploadReceipt.single('receipt'), async (req, res) => {
  const { datetime, amount, type, notes } = req.body;
  let transactionType;
  if (req.user.role === 'admin') {
    // Admin can only add cash credit transactions (stored as 'given' for compatibility)
    transactionType = 'given';
  } else {
    // Helper can add spent transactions, ensure not cash credit aliases
    if (CASH_ALIASES.has(type)) return res.status(403).json({ error: 'Helper cannot add credit transactions' });
    transactionType = type || 'other';
  }
  try {
    const receiptUrl = req.file ? `/uploads/receipts/${req.file.filename}` : null;
    const result = await pool.query(
      'INSERT INTO transactions (datetime, amount, type, notes, receipt_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [datetime, amount, transactionType, notes, receiptUrl]
    );
    res.json(result.rows[0]);
    sendWhatsAppNotification(result.rows[0], req.user.username).catch(err =>
      console.error('WA notification error:', err.message)
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete transaction (admin only)
route('delete', '/api/transactions/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    await pool.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get reports (admin only)
route('get', '/api/reports', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const totalSpent = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type NOT IN ('given', 'cash')");
    const totalGiven = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type IN ('given', 'cash')");
    const monthly = await pool.query(
      "SELECT TO_CHAR(datetime AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM') as month, type, SUM(amount) as total FROM transactions WHERE type NOT IN ('given', 'cash') GROUP BY month, type ORDER BY month DESC, type"
    );
    const monthlyGiven = await pool.query(
      "SELECT TO_CHAR(datetime AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM') as month, SUM(amount) as total FROM transactions WHERE type IN ('given', 'cash') GROUP BY month ORDER BY month DESC"
    );
    res.json({
      totalSpent: totalSpent.rows[0].total || 0,
      totalGiven: totalGiven.rows[0].total || 0,
      monthly: monthly.rows,
      monthlyGiven: monthlyGiven.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get users (admin only)
route('get', '/api/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const result = await pool.query('SELECT id, username, role FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new user (admin only)
route('post', '/api/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required' });
  }
  if (!['admin', 'helper'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or helper' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, role]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Update user password (admin only)
route('put', '/api/users/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { password, username, role } = req.body;
  try {
    // If password is provided, update it
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, req.params.id]);
      res.json({ message: 'Password updated successfully' });
    }
    // If username or role is provided, update them
    else if (username || role) {
      if (role && !['admin', 'helper'].includes(role)) {
        return res.status(400).json({ error: 'Role must be admin or helper' });
      }
      let updateFields = [];
      let values = [];
      let paramCount = 1;
      
      if (username) {
        updateFields.push(`username = $${paramCount}`);
        values.push(username);
        paramCount++;
      }
      if (role) {
        updateFields.push(`role = $${paramCount}`);
        values.push(role);
        paramCount++;
      }
      
      values.push(req.params.id);
      const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING id, username, role`;
      const result = await pool.query(query, values);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(result.rows[0]);
    } else {
      res.status(400).json({ error: 'No update fields provided' });
    }
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Delete user (admin only)
route('delete', '/api/users/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  // Prevent deleting the current user
  if (req.user.id == req.params.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get transaction types
route('get', '/api/transaction-types', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, category FROM transaction_types ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add transaction type (admin only)
route('post', '/api/transaction-types', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { name, category } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'Name and category required' });
  }
  if (!['credit', 'expense'].includes(category)) {
    return res.status(400).json({ error: 'Category must be credit or expense' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO transaction_types (name, category) VALUES ($1, $2) RETURNING *',
      [name.toLowerCase(), category]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Transaction type already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Update transaction type (admin only)
route('put', '/api/transaction-types/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { name, category } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'Name and category required' });
  }
  if (!['credit', 'expense'].includes(category)) {
    return res.status(400).json({ error: 'Category must be credit or expense' });
  }
  try {
    const result = await pool.query(
      'UPDATE transaction_types SET name = $1, category = $2 WHERE id = $3 RETURNING *',
      [name.toLowerCase(), category, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction type not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Transaction type already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Delete transaction type (admin only)
route('delete', '/api/transaction-types/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    await pool.query('DELETE FROM transaction_types WHERE id = $1', [req.params.id]);
    res.json({ message: 'Transaction type deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Receipt image must be 5MB or smaller' : err.message;
    return res.status(400).json({ error: message });
  }
  if (err && err.message === 'Only image files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

async function sendWhatsAppNotification(transaction, username) {
  if (!WA_GATEWAY_URL || !WA_GATEWAY_TOKEN || !WA_GROUP_JID) return;

  const sign = CASH_ALIASES.has(transaction.type) ? '+' : '-';
  const dtStr = new Date(transaction.datetime).toLocaleString('en-HK', {
    timeZone: 'Asia/Hong_Kong', dateStyle: 'short', timeStyle: 'short',
  });

  let text = `🛒 *GroceryMate*\n`;
  text += `📅 ${dtStr}\n`;
  text += `📌 Type: ${transaction.type}\n`;
  text += `💵 Amount: ${sign}$${parseFloat(transaction.amount).toFixed(2)}\n`;
  if (transaction.notes) text += `📝 Notes: ${transaction.notes}\n`;
  text += `👤 Added by: ${username}`;

  const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': WA_GATEWAY_TOKEN };

  try {
    if (transaction.receipt_url && APP_INTERNAL_URL) {
      const receiptUrl = `${APP_INTERNAL_URL}${transaction.receipt_url}`;
      await fetch(`${WA_GATEWAY_URL}/send_image`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ number: WA_GROUP_JID, url: receiptUrl, caption: text }),
      });
    } else {
      await fetch(`${WA_GATEWAY_URL}/send_message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ number: WA_GROUP_JID, message: text }),
      });
    }
  } catch (err) {
    console.error('WhatsApp notification failed:', err.message);
  }
}

// Start server
async function startWithRetry(maxAttempts = 20, delayMs = 1500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await ensureSchemaCompat();
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`GroceryMate running on port ${PORT}`);
      });
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error('Schema compatibility check failed:', err.message);
        process.exit(1);
      }
      console.log(`Waiting for database... (${attempt}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

startWithRetry();