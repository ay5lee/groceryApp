-- Database grocery_mate is already created by POSTGRES_DB

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(10) NOT NULL CHECK (role IN ('admin', 'helper'))
);

-- Transaction types table
CREATE TABLE IF NOT EXISTS transaction_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  category VARCHAR(20) NOT NULL CHECK (category IN ('credit', 'expense')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  datetime TIMESTAMP NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  type VARCHAR(50) NOT NULL,
  receipt_url TEXT,
  notes TEXT,
  FOREIGN KEY (type) REFERENCES transaction_types(name)
);

-- Insert sample users (passwords are hashed)
INSERT INTO users (username, password_hash, role) VALUES
('admin', '$2a$10$wUXDkAcTYbRF9o.ifbUBtu5iQUd4.5pZYwn2dIGPA.ntUSrXp.8bS', 'admin'),
('helper', '$2a$10$ySD5fP13iEofXAU4ohzpkewpP1.mbNRlZqsV6dR3LnSjfB7QvwsiK', 'helper')
ON CONFLICT (username) DO NOTHING;

-- Insert default transaction types
INSERT INTO transaction_types (name, category) VALUES
('given', 'credit'),
('vegetable', 'expense'),
('meat', 'expense'),
('fish', 'expense'),
('other', 'expense')
ON CONFLICT (name) DO NOTHING;