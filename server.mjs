import { createServer } from 'node:http';
import { createCipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrices } from './getPrices.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
async function loadDataGovApiKeyFromFile() {
  if (process.env.DATA_GOV_API_KEY) return;
  const contents = await readFile(path.join(ROOT, '.env'), 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error));
  const line = contents.split(/\r?\n/).find((item) => /^\s*DATA_GOV_API_KEY\s*=/.test(item));
  if (!line) return;
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/^['\"]|['\"]$/g, '');
  if (value) process.env.DATA_GOV_API_KEY = value;
}
await loadDataGovApiKeyFromFile();
const INDIA_LOCATIONS = JSON.parse(await readFile(path.join(ROOT, 'india-locations.json'), 'utf8'));
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'farmers-connect.sqlite');
const IDENTITY_KEY_FILE = path.join(DATA_DIR, 'identity.key');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const DEV_OTP = process.env.DEV_OTP || '123456';
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_REGISTRATION_FILE_BYTES = 2 * 1024 * 1024;
const MARKET_PRICE_RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070';
const MARKET_PRICE_SOURCE_URL = `https://api.data.gov.in/resource/${MARKET_PRICE_RESOURCE_ID}`;
const MARKET_PRICE_API_VERSION = 2;
const MARKET_PRICE_CACHE_TTL = 10 * 60 * 1000;
const marketPriceCache = new Map();
const otpChallenges = new Map();
const SAFE_ICONS = new Set(['🌱', '🍅', '🌾', '🧅', '🥭', '🥔', '🍚', '🥬']);
const SAFE_COLORS = new Set(['#eff3e4', '#f7efe0', '#f2efdf', '#e9f2e8', '#f3e8e7', '#f0eee7']);

await mkdir(DATA_DIR, { recursive: true });
async function loadIdentityEncryptionKey() {
  const configured = process.env.IDENTITY_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-f0-9]{64}$/i.test(configured)) throw new Error('IDENTITY_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).');
    return Buffer.from(configured, 'hex');
  }
  if (IS_PRODUCTION) throw new Error('Set IDENTITY_ENCRYPTION_KEY before starting in production.');
  try {
    const key = await readFile(IDENTITY_KEY_FILE);
    if (key.length !== 32) throw new Error('The local identity encryption key is invalid.');
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const key = randomBytes(32);
    try {
      await writeFile(IDENTITY_KEY_FILE, key, { flag: 'wx', mode: 0o600 });
      return key;
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      const existingKey = await readFile(IDENTITY_KEY_FILE);
      if (existingKey.length !== 32) throw new Error('The local identity encryption key is invalid.');
      return existingKey;
    }
  }
}
const IDENTITY_ENCRYPTION_KEY = await loadIdentityEncryptionKey();
export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('farmer', 'consumer', 'industry')),
    location TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
    about TEXT NOT NULL DEFAULT '',
    notifications INTEGER NOT NULL DEFAULT 1,
    verified INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    state_name TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL DEFAULT '',
    village TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    owner_name TEXT NOT NULL DEFAULT '',
    occupation TEXT NOT NULL DEFAULT '',
    gstin TEXT NOT NULL DEFAULT '',
    registration_data TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    crop TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('Vegetables', 'Fruits', 'Grains', 'Other')),
    icon TEXT NOT NULL DEFAULT '🌱',
    price REAL NOT NULL CHECK (price > 0),
    unit TEXT NOT NULL,
    qty REAL NOT NULL CHECK (qty >= 0),
    quality TEXT NOT NULL DEFAULT 'Fresh',
    rating REAL NOT NULL DEFAULT 0,
    harvest TEXT NOT NULL DEFAULT 'Today',
    location TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#eff3e4',
    note TEXT NOT NULL DEFAULT '',
    photo_data BLOB,
    photo_type TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS listings_active_idx ON listings(active, created_at DESC);
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    farmer_id INTEGER NOT NULL REFERENCES users(id),
    crop TEXT NOT NULL,
    icon TEXT NOT NULL,
    qty REAL NOT NULL CHECK (qty > 0),
    unit TEXT NOT NULL,
    unit_price REAL NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Payment pending',
    payment_status TEXT NOT NULL DEFAULT 'not_connected',
    delivery_preference TEXT NOT NULL DEFAULT 'Coordinate with seller',
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders(buyer_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS orders_farmer_idx ON orders(farmer_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('orders', 'payments', 'messages')),
    kind TEXT NOT NULL,
    actor_name TEXT NOT NULL DEFAULT '',
    crop TEXT NOT NULL DEFAULT '',
    quantity REAL,
    unit TEXT NOT NULL DEFAULT '',
    amount REAL,
    detail TEXT NOT NULL DEFAULT '',
    order_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT
  );
  CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    recipient_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages(sender_id, recipient_id, id);
  CREATE TABLE IF NOT EXISTS requirements (
    id TEXT PRIMARY KEY,
    industry_id INTEGER NOT NULL REFERENCES users(id),
    crop TEXT NOT NULL,
    qty REAL NOT NULL CHECK (qty > 0),
    unit TEXT NOT NULL,
    needed_by TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    matches INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Open',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS market_prices (
    crop TEXT PRIMARY KEY,
    crop_hi TEXT NOT NULL,
    icon TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    change_pct REAL NOT NULL,
    region TEXT NOT NULL
  );
`);
if (!db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'password_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
}
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
for (const [column, definition] of Object.entries({
  state_name: "TEXT NOT NULL DEFAULT ''",
  district: "TEXT NOT NULL DEFAULT ''",
  village: "TEXT NOT NULL DEFAULT ''",
  email: "TEXT NOT NULL DEFAULT ''",
  owner_name: "TEXT NOT NULL DEFAULT ''",
  occupation: "TEXT NOT NULL DEFAULT ''",
  gstin: "TEXT NOT NULL DEFAULT ''",
  registration_data: "TEXT NOT NULL DEFAULT ''",
})) {
  if (!userColumns.has(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
}
const listingColumns = db.prepare('PRAGMA table_info(listings)').all();
if (!listingColumns.some((column) => column.name === 'photo_data')) db.exec('ALTER TABLE listings ADD COLUMN photo_data BLOB');
if (!listingColumns.some((column) => column.name === 'photo_type')) db.exec('ALTER TABLE listings ADD COLUMN photo_type TEXT');

function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, encodedHash) {
  if (typeof encodedHash !== 'string') return false;
  const [saltHex, hashHex] = encodedHash.split(':');
  if (!/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{128}$/i.test(hashHex || '')) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}
function cleanPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw httpError(400, 'Password must be between 8 and 128 characters.');
  return value;
}
function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(phone)) phone = `+91${phone}`;
  else if (/^0\d{10}$/.test(phone)) phone = `+91${phone.slice(1)}`;
  else if (/^\d{11,15}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw httpError(400, 'Enter a valid phone number with country code.');
  return phone;
}
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function validRegion(stateName, district) { return INDIA_LOCATIONS.some((entry) => entry.state === stateName && entry.districts.includes(district)); }
function listingLocation(body, fallback) {
  if (body.state === undefined && body.district === undefined) return cleanText(body.location, 120, fallback);
  const stateName = requireString(body.state, 'State', 80);
  const district = requireString(body.district, 'District', 80);
  if (!validRegion(stateName, district)) throw httpError(400, 'Choose a district from the selected state.');
  return district + ', ' + stateName;
}
function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function userView(row) {
  if (!row) return null;
  return { id: row.id, phone: row.phone, name: row.name, role: row.role, location: row.location, state: row.state_name || '', district: row.district || '', village: row.village || '', email: row.email || '', ownerName: row.owner_name || '', occupation: row.occupation || '', gstin: row.gstin || '', language: row.language, about: row.about, notifications: Boolean(row.notifications), verified: Boolean(row.verified) };
}
function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}
function currentUser(req) {
  const token = readCookie(req, 'fc_session');
  if (!token) return null;
  const session = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(hashToken(token), Math.floor(Date.now() / 1000));
  return userView(session);
}
function requireUser(req) { const user = currentUser(req); if (!user) throw httpError(401, 'Sign in to continue.'); return user; }
function requireRole(user, ...roles) { if (!roles.includes(user.role)) throw httpError(403, 'This account role cannot perform that action.'); }
function setSessionCookie(token) {
  return `fc_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}${IS_PRODUCTION ? '; Secure' : ''}`;
}
function initials(name) { return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase(); }
function publicListing(row) {
  return { id: row.id, sellerId: row.seller_id, crop: row.crop, category: row.category, icon: row.icon, seller: row.seller_name, initials: initials(row.seller_name), location: row.location, price: row.price, unit: row.unit, qty: row.qty, quality: row.quality, rating: row.rating, verified: Boolean(row.seller_verified), harvest: row.harvest, color: row.color, note: row.note, photoUrl: row.photo_data ? `/api/listings/${encodeURIComponent(row.id)}/photo` : '' };
}
function allListings() {
  return db.prepare(`SELECT l.*, u.name AS seller_name, u.verified AS seller_verified FROM listings l
    JOIN users u ON u.id = l.seller_id WHERE l.active = 1 AND l.qty > 0 ORDER BY l.created_at DESC`).all().map(publicListing);
}
function getOrders(user) {
  return db.prepare(`SELECT o.*, CASE WHEN o.farmer_id = ? THEN buyer.name ELSE farmer.name END AS other_name
    FROM orders o JOIN users buyer ON buyer.id = o.buyer_id JOIN users farmer ON farmer.id = o.farmer_id
    WHERE o.buyer_id = ? OR o.farmer_id = ? ORDER BY o.created_at DESC LIMIT 100`).all(user.id, user.id, user.id).map((o) => ({
    id: o.id, crop: o.crop, icon: o.icon, other: o.other_name, qty: o.qty, unit: o.unit, total: o.total,
    status: o.status, paymentStatus: o.payment_status, date: new Date(`${o.created_at.replace(' ', 'T')}Z`).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
  }));
}
function addNotification(userId, category, kind, data = {}) {
  const preferences = db.prepare('SELECT notifications FROM users WHERE id = ?').get(userId);
  if (!preferences?.notifications) return;
  db.prepare(`INSERT INTO notifications (user_id, category, kind, actor_name, crop, quantity, unit, amount, detail, order_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, category, kind, String(data.actorName || ''), String(data.crop || ''), data.quantity ?? null,
      String(data.unit || ''), data.amount ?? null, String(data.detail || ''), String(data.orderId || ''));
}
function getNotifications(user) {
  return db.prepare(`SELECT id, category, kind, actor_name, crop, quantity, unit, amount, detail, order_id, created_at, read_at
    FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100`).all(user.id).map((item) => ({
    id: item.id, category: item.category, kind: item.kind, actorName: item.actor_name, crop: item.crop,
    quantity: item.quantity, unit: item.unit, amount: item.amount, detail: item.detail, orderId: item.order_id,
    date: new Date(`${item.created_at.replace(' ', 'T')}Z`).toLocaleString(user.language === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    read: Boolean(item.read_at),
  }));
}
function getConversations(user) {
  const rows = db.prepare(`SELECT m.id, m.sender_id, m.recipient_id, m.body, m.created_at,
      sender.name AS sender_name, recipient.name AS recipient_name
    FROM messages m JOIN users sender ON sender.id = m.sender_id JOIN users recipient ON recipient.id = m.recipient_id
    WHERE m.sender_id = ? OR m.recipient_id = ? ORDER BY m.id ASC`).all(user.id, user.id);
  const conversations = new Map();
  for (const row of rows) {
    const otherId = row.sender_id === user.id ? row.recipient_id : row.sender_id;
    const otherName = row.sender_id === user.id ? row.recipient_name : row.sender_name;
    const id = String(otherId);
    if (!conversations.has(id)) conversations.set(id, { id, recipientId: otherId, name: otherName, initials: initials(otherName), preview: '', messages: [], lastId: 0 });
    const conversation = conversations.get(id);
    const time = new Date(`${row.created_at.replace(' ', 'T')}Z`).toLocaleTimeString(user.language === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' });
    conversation.messages.push({ text: row.body, mine: row.sender_id === user.id, time });
    conversation.preview = row.body;
    conversation.lastId = row.id;
  }
  return [...conversations.values()].sort((a, b) => b.lastId - a.lastId).map(({ lastId, ...conversation }) => conversation);
}
function getRequirements(user) {
  return db.prepare('SELECT * FROM requirements WHERE industry_id = ? ORDER BY created_at DESC').all(user.id).map((r) => ({
    id: r.id, crop: r.crop, qty: r.qty, unit: r.unit, date: r.needed_by, matches: r.matches, status: r.status, details: r.details,
  }));
}
function marketPriceDate(value) {
  const text = String(value || '').trim();
  const dayFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirst) return `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : '';
}
function marketPriceNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replaceAll(',', '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function marketPriceField(record, ...names) {
  const entries = Object.entries(record || {});
  const normalized = new Map(entries.map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value]));
  for (const name of names) {
    const value = normalized.get(name.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}
function mapOfficialMarketPrice(record) {
  const minPrice = marketPriceNumber(marketPriceField(record, 'min_price', 'minprice', 'minimum_price'));
  const maxPrice = marketPriceNumber(marketPriceField(record, 'max_price', 'maxprice', 'maximum_price'));
  const modalPrice = marketPriceNumber(marketPriceField(record, 'modal_price', 'modalprice', 'modal'));
  return {
    state: cleanText(marketPriceField(record, 'state', 'state_name', 'state_ut'), 100),
    district: cleanText(marketPriceField(record, 'district', 'district_name'), 100),
    market: cleanText(marketPriceField(record, 'market', 'market_name', 'mandi'), 120),
    commodity: cleanText(marketPriceField(record, 'commodity', 'commodity_name', 'crop'), 120),
    variety: cleanText(marketPriceField(record, 'variety', 'commodity_variety'), 120),
    grade: cleanText(marketPriceField(record, 'grade', 'commodity_grade'), 60),
    minPrice,
    maxPrice,
    modalPrice,
    priceUnit: 'Rs./Quintal',
    priceDate: marketPriceDate(marketPriceField(record, 'price_date', 'arrival_date', 'reported_date', 'date')),
  };
}
// Fetches one page from data.gov.in with a generous timeout and retries, and logs the REAL
// failure reason (HTTP status or network error code) to the terminal so it can be diagnosed.
async function fetchMarketPricePage(requestUrl) {
  const attempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(requestUrl, { headers: { Accept: 'application/json', 'User-Agent': 'FarmersConnect/0.2' }, signal: AbortSignal.timeout(45_000) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      console.error(`[market-prices] data.gov.in answered HTTP ${response.status} (attempt ${attempt}/${attempts})`);
      if (response.status === 401 || response.status === 403) throw httpError(502, `data.gov.in refused the request (HTTP ${response.status}). Check DATA_GOV_API_KEY, or whether this network blocks api.data.gov.in.`);
      lastError = httpError(502, `The official market price service is temporarily unavailable (HTTP ${response.status}).`);
    } catch (error) {
      if (error.status) throw error;
      console.error(`[market-prices] request failed (attempt ${attempt}/${attempts}): ${error?.name} code=${error?.cause?.code || error?.code || 'n/a'} ${error?.cause?.message || error?.message || ''}`);
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  throw lastError;
}
async function getOfficialMarketPrices(stateName, forceRefresh = false) {
  const selectedState = cleanText(stateName, 80);
  if (!INDIA_LOCATIONS.some((entry) => entry.state === selectedState)) throw httpError(400, 'Choose a valid state to load official market prices.');
  const now = Date.now();
  const cached = marketPriceCache.get(selectedState);
  if (cached && cached.expiresAt > now && (!forceRefresh || now - cached.fetchedAt < 60_000)) return cached;
  const apiKey = String(process.env.DATA_GOV_API_KEY || '').trim();
  if (!apiKey) return {
    records: [], total: 0, sourceRecordCount: 0, unmappedRecordCount: 0,
    sourceUpdatedAt: '', fetchedAt: now, expiresAt: now,
    marketPriceApiVersion: MARKET_PRICE_API_VERSION,
    setupRequired: true,
    message: 'Official market prices need a data.gov.in API key. Add DATA_GOV_API_KEY to .env and restart the app.',
  };

  const pageSize = 1_000;
  const maxPages = 40;
  const records = [];
  let sourceRecordCount = 0;
  let unmappedRecordCount = 0;
  let total = 0;
  let sourceUpdatedAt = '';
  let offset = 0;
  try {
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const requestUrl = new URL(MARKET_PRICE_SOURCE_URL);
      requestUrl.searchParams.set('api-key', apiKey);
      requestUrl.searchParams.set('format', 'json');
      requestUrl.searchParams.set('limit', String(pageSize));
      requestUrl.searchParams.set('offset', String(offset));
      requestUrl.searchParams.set('filters[state]', selectedState);
      const payload = await fetchMarketPricePage(requestUrl);
      if (!Array.isArray(payload.records)) throw httpError(502, 'The official market price service returned an unexpected response.');
      if (!pageNumber) {
        total = Number(payload.total) || payload.records.length;
        sourceUpdatedAt = String(payload.updated_date || '');
        const reportedLimit = Number(payload.limit);
        if (reportedLimit > 0 && reportedLimit <= 10 && total > payload.records.length) {
          throw httpError(503, 'The data.gov.in sample key returns only a few rows. Use a personal API key to load all market prices.');
        }
      }
      sourceRecordCount += payload.records.length;
      const mappedRecords = payload.records.map(mapOfficialMarketPrice);
      const usableRecords = mappedRecords.filter((record) => record.state && record.district && record.commodity && [record.minPrice, record.maxPrice, record.modalPrice].some((price) => price !== null));
      unmappedRecordCount += mappedRecords.length - usableRecords.length;
      records.push(...usableRecords);
      offset += payload.records.length;
      if (!payload.records.length || (total && offset >= total)) break;
      if (payload.records.length < pageSize && payload.records.length < 100 && total > offset) {
        throw httpError(503, 'The data.gov.in API returned only a small sample. Use a personal API key to load all market prices.');
      }
      if (pageNumber === maxPages - 1 && total > offset) throw httpError(502, 'The official market price service returned an incomplete result. Try again later.');
    }
  } catch (error) {
    if (error.status) throw error;
    const networkCode = error?.cause?.code || error?.code || '';
    if (error.name === 'TimeoutError' || networkCode === 'UND_ERR_CONNECT_TIMEOUT' || networkCode === 'ETIMEDOUT') {
      throw httpError(504, 'The app server timed out connecting to api.data.gov.in. Check that this computer or network allows outgoing HTTPS connections to api.data.gov.in, then retry.');
    }
    if (networkCode === 'ENOTFOUND' || networkCode === 'EAI_AGAIN') {
      throw httpError(502, 'The app server could not resolve api.data.gov.in. Check this computer’s internet or DNS connection, then retry.');
    }
    throw httpError(502, 'The app server could not connect to api.data.gov.in. Check this computer’s internet, firewall, or proxy settings, then retry.');
  }
  records.sort((left, right) => right.priceDate.localeCompare(left.priceDate) || left.state.localeCompare(right.state) || left.district.localeCompare(right.district));
  const report = {
    records, total: records.length, sourceRecordCount, unmappedRecordCount,
    sourceUpdatedAt, fetchedAt: now, expiresAt: now + MARKET_PRICE_CACHE_TTL,
    marketPriceApiVersion: MARKET_PRICE_API_VERSION,
  };
  marketPriceCache.set(selectedState, report);
  return report;
}
const LOCATION_NEARBY_CITIES = {
  nashik: ['nashik', 'lasalgaon'],
  pune: ['pune'],
  indore: ['indore'],
  agra: ['agra'],
  karnal: ['karnal'],
};
const LOCATION_STATE_CODES = [
  ['maharashtra', 'mh'], ['madhya pradesh', 'mp'], ['uttar pradesh', 'up'], ['haryana', 'hr'],
];
function locationCity(location) { return String(location || '').split(',')[0].trim().toLowerCase(); }
function locationStateCode(location) {
  const normalized = String(location || '').toLowerCase();
  for (const [stateName, code] of LOCATION_STATE_CODES) {
    if (normalized.includes(stateName) || new RegExp(`(?:^|[,\\s])${code}(?:$|[,\\s])`, 'i').test(normalized)) return code;
  }
  return '';
}
function locationsShareCity(location, selectedLocation) {
  const city = locationCity(selectedLocation);
  const nearbyCities = LOCATION_NEARBY_CITIES[city] || [city];
  const recordCity = locationCity(location);
  return nearbyCities.some((nearbyCity) => recordCity === nearbyCity);
}
function nearbyListings(location) {
  const listings = allListings();
  const local = listings.filter((listing) => locationsShareCity(listing.location, location));
  if (local.length) return local;
  const stateCode = locationStateCode(location);
  if (!stateCode) return listings;
  return listings.filter((listing) => locationStateCode(listing.location) === stateCode);
}
function regionalPrices(location) {
  const prices = getPrices();
  const local = prices.filter((price) => locationsShareCity(price.region, location));
  if (local.length) return local;
  const stateCode = locationStateCode(location);
  if (!stateCode) return prices;
  const inState = prices.filter((price) => locationStateCode(price.region) === stateCode);
  return inState.length ? inState : prices;
}
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 3_000_000) throw httpError(413, 'Request is too large.');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw httpError(400, 'Invalid JSON request.'); }
}
function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const expected = `http://${req.headers.host}`;
  const secureExpected = `https://${req.headers.host}`;
  if (origin !== expected && origin !== secureExpected) throw httpError(403, 'Cross-origin request blocked.');
}
function cleanText(value, maxLength, fallback = '') {
  const text = String(value ?? fallback).trim();
  if (text.length > maxLength) throw httpError(400, `Text must be ${maxLength} characters or fewer.`);
  return text;
}
function safeIcon(value) {
  const icon = cleanText(value, 12, '🌱');
  return SAFE_ICONS.has(icon) ? icon : '🌱';
}
function safeColor(value) {
  const color = cleanText(value, 20, '#eff3e4').toLowerCase();
  return SAFE_COLORS.has(color) ? color : '#eff3e4';
}
function parsePhoto(photoData, photoType) {
  if (photoData === null || photoData === '') return { data: null, type: null };
  if (typeof photoData !== 'string') throw httpError(400, 'Choose a valid crop photo.');
  const type = String(photoType || '').toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw httpError(400, 'Crop photos must be JPG, PNG, or WebP.');
  if (photoData.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4) throw httpError(413, 'Crop photos must be 2 MB or smaller.');
  const data = Buffer.from(photoData, 'base64');
  if (!data.length || data.length > MAX_PHOTO_BYTES || data.toString('base64') !== photoData) throw httpError(400, 'The crop photo could not be read. Choose a JPG, PNG, or WebP image.');
  const isJpeg = type === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const isPng = type === 'image/png' && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = type === 'image/webp' && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw httpError(400, 'The photo content does not match its image type.');
  return { data, type };
}
function parseRegistrationDocument(document, required = false) {
  if (!document || !document.data) {
    if (required) throw httpError(400, 'Upload the required registration document.');
    return null;
  }
  if (typeof document.data !== 'string') throw httpError(400, 'Choose a valid verification document.');
  const type = String(document.type || '').toLowerCase();
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(type)) throw httpError(400, 'Documents must be PDF, JPG, PNG, or WebP files.');
  if (document.data.length > Math.ceil(MAX_REGISTRATION_FILE_BYTES / 3) * 4) throw httpError(413, 'Verification documents must be 2 MB or smaller.');
  const data = Buffer.from(document.data, 'base64');
  if (!data.length || data.length > MAX_REGISTRATION_FILE_BYTES || data.toString('base64') !== document.data) throw httpError(400, 'The verification document could not be read.');
  const validPdf = type === 'application/pdf' && data.toString('ascii', 0, 5) === '%PDF-';
  const validJpeg = type === 'image/jpeg' && data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const validPng = type === 'image/png' && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const validWebp = type === 'image/webp' && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (!validPdf && !validJpeg && !validPng && !validWebp) throw httpError(400, 'The document content does not match its file type.');
  const name = String(document.name || 'verification-document').split(/[\\/]/).pop().slice(0, 120);
  return { name, type, data: data.toString('base64') };
}
function encryptRegistrationData(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', IDENTITY_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
}
function positiveNumber(value, name, max = 1_000_000) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) throw httpError(400, `Enter a valid ${name}.`);
  return number;
}
function requireString(value, name, maxLength = 100) {
  const text = cleanText(value, maxLength);
  if (!text) throw httpError(400, `${name} is required.`);
  return text;
}
function createOrder(user, body) {
  requireRole(user, 'consumer', 'industry');
  const listingId = requireString(body.listingId, 'Listing', 32);
  const qty = positiveNumber(body.qty, 'quantity');
  const listing = db.prepare(`SELECT l.*, u.name AS seller_name FROM listings l JOIN users u ON u.id = l.seller_id
    WHERE l.id = ? AND l.active = 1`).get(listingId);
  if (!listing) throw httpError(404, 'This listing is no longer available.');
  if (listing.seller_id === user.id) throw httpError(400, 'You cannot order your own listing.');
  if (qty > listing.qty) throw httpError(400, `Only ${listing.qty} ${listing.unit} are currently available.`);
  const orderId = `ORD-${randomBytes(4).toString('hex').toUpperCase()}`;
  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare('UPDATE listings SET qty = qty - ? WHERE id = ? AND active = 1 AND qty >= ?').run(qty, listingId, qty);
    if (Number(update.changes) !== 1) throw httpError(409, 'The available quantity changed. Refresh the listing and try again.');
    db.prepare(`INSERT INTO orders (id, listing_id, buyer_id, farmer_id, crop, icon, qty, unit, unit_price, total, status, payment_status, delivery_preference, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Payment pending', 'not_connected', ?, ?)`)
      .run(orderId, listingId, user.id, listing.seller_id, listing.crop, listing.icon, qty, listing.unit, listing.price, listing.price * qty,
        cleanText(body.delivery, 80, 'Coordinate with seller'), cleanText(body.message, 1000));
    const notificationData = { crop: listing.crop, quantity: qty, unit: listing.unit, amount: listing.price * qty, orderId };
    addNotification(user.id, 'orders', 'order_placed', { ...notificationData, actorName: listing.seller_name });
    addNotification(listing.seller_id, 'orders', 'order_received', { ...notificationData, actorName: user.name });
    const message = cleanText(body.message, 1000);
    if (message) db.prepare('INSERT INTO messages (sender_id, recipient_id, body) VALUES (?, ?, ?)').run(user.id, listing.seller_id, message);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { id: orderId, crop: listing.crop, icon: listing.icon, other: listing.seller_name, qty, unit: listing.unit, total: listing.price * qty, status: 'Payment pending', paymentStatus: 'not_connected', date: 'Just now' };
}
function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expires);
  return token;
}
function publicFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.replace(/\/+$/, '').toLowerCase() === '/dashboard') return path.join(ROOT, 'index.html');
  const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
  const allowed = new Set(['index.html', 'client.js', 'styles.css', 'manifest.webmanifest', 'service-worker.js', 'india-locations.json', 'assets/leaf.svg']);
  if (!allowed.has(relative)) return null;
  return path.join(ROOT, relative);
}
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
}

async function routeApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;
  const headers = securityHeaders();

  if (method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, database: 'sqlite' }, headers);
  if (method === 'GET' && pathname === '/api/locations') return json(res, 200, { locations: INDIA_LOCATIONS }, headers);
  if (method === 'GET' && pathname === '/api/session') return json(res, 200, { user: currentUser(req) }, headers);
  if (method === 'POST' && pathname === '/api/auth/request-otp') {
    checkSameOrigin(req);
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    if (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) throw httpError(409, 'An account already uses this phone. Log in instead.');
    const role = String(body.role || '');
    if (!['farmer', 'consumer', 'industry'].includes(role)) throw httpError(400, 'Choose an account role.');
    const name = requireString(body.name, 'Name', 100);
    const passwordHash = hashPassword(cleanPassword(body.password));
    const language = body.language === 'hi' ? 'hi' : 'en';
    let stateName = '';
    let district = '';
    let village = '';
    let location = '';
    let email = '';
    let ownerName = '';
    let occupation = '';
    let gstin = '';
    const registrationData = {};
    if (role === 'farmer' || role === 'consumer') {
      stateName = requireString(body.state, 'State', 80);
      district = requireString(body.district, 'District', 80);
      if (!validRegion(stateName, district)) throw httpError(400, 'Choose a district from the selected state.');
      village = requireString(body.village, 'Village', 100);
      location = `${district}, ${stateName}`;
      const idType = String(body.govtIdType || '');
      const idTypes = new Set(['aadhaar', 'voter-id', 'pan', 'driving-license', 'passport', 'other']);
      if (!idTypes.has(idType)) throw httpError(400, 'Choose a government-issued ID type.');
      let idNumber = cleanText(body.govtIdNumber, 60);
      if (idType === 'aadhaar' && idNumber) {
        idNumber = idNumber.replace(/[\s-]/g, '');
        if (!/^\d{12}$/.test(idNumber)) throw httpError(400, 'Enter a valid 12-digit Aadhaar number or upload its document.');
      }
      const governmentDocument = parseRegistrationDocument(body.govtIdDocument);
      if (!idNumber && !governmentDocument) throw httpError(400, 'Enter your government ID number or upload an ID document.');
      registrationData.governmentId = { type: idType, number: idNumber, document: governmentDocument };
      if (role === 'farmer') {
        const proofType = String(body.farmerProofType || '');
        const proofTypes = new Set(['farmer-registry', 'kcc', 'land-record', 'pm-kisan']);
        if (!proofTypes.has(proofType)) throw httpError(400, 'Choose a farmer verification detail.');
        registrationData.farmerProof = { type: proofType, value: requireString(body.farmerProofValue, 'Farmer verification detail', 120) };
      } else {
        occupation = requireString(body.occupation, 'Occupation', 100);
      }
    } else {
      stateName = requireString(body.state, 'State', 80);
      district = requireString(body.district, 'District', 80);
      if (!validRegion(stateName, district)) throw httpError(400, 'Choose a district from the selected state.');
      location = `${district}, ${stateName}`;
      ownerName = requireString(body.ownerName, 'Owner or authorized person', 100);
      email = requireString(body.email, 'Email', 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Enter a valid email address.');
      gstin = requireString(body.gstin, 'GSTIN', 15).toUpperCase();
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw httpError(400, 'Enter a valid 15-character GSTIN.');
      registrationData.industryDocument = parseRegistrationDocument(body.industryDocument, true);
    }
    const account = {
      name, role, password_hash: passwordHash, language, location,
      state_name: stateName, district, village, email, owner_name: ownerName,
      occupation, gstin, registration_data: encryptRegistrationData(registrationData),
    };
    if (IS_PRODUCTION) throw httpError(503, 'Phone sign-in is unavailable until an SMS OTP provider is configured.');
    otpChallenges.set(phone, { purpose: 'signup', otp: DEV_OTP, expiresAt: Date.now() + 5 * 60 * 1000, account });
    return json(res, 200, { sent: true, demo: true, devOtp: DEV_OTP, expiresIn: 300 }, headers);
  }
  if (method === 'POST' && pathname === '/api/auth/verify-otp') {
    checkSameOrigin(req);
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    const challenge = otpChallenges.get(phone);
    if (!challenge || challenge.purpose !== 'signup' || challenge.expiresAt < Date.now() || String(body.otp || '') !== challenge.otp) throw httpError(401, 'The verification code is invalid or expired.');
    if (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) throw httpError(409, 'An account already uses this phone. Log in instead.');
    const account = challenge.account;
    const result = db.prepare(`INSERT INTO users (phone, name, role, location, state_name, district, village, email, owner_name, occupation, gstin, language, password_hash, registration_data, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(phone, account.name, account.role, account.location, account.state_name, account.district, account.village, account.email, account.owner_name, account.occupation, account.gstin, account.language, account.password_hash, account.registration_data);
    otpChallenges.delete(phone);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
    const token = createSession(user.id);
    return json(res, 200, { user: userView(user) }, { ...headers, 'Set-Cookie': setSessionCookie(token) });
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    checkSameOrigin(req);
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!user || !user.password_hash || password.length > 128 || !verifyPassword(password, user.password_hash)) throw httpError(401, 'Phone number or password is incorrect.');
    const token = createSession(user.id);
    return json(res, 200, { user: userView(user) }, { ...headers, 'Set-Cookie': setSessionCookie(token) });
  }
  if (method === 'POST' && pathname === '/api/auth/request-password-setup-otp') {
    checkSameOrigin(req);
    const phone = normalizePhone((await readJson(req)).phone);
    const user = db.prepare('SELECT id, password_hash FROM users WHERE phone = ?').get(phone);
    if (!user) throw httpError(404, 'No account uses this phone number. Create an account first.');
    if (user.password_hash) throw httpError(409, 'This account already has a password. Log in with it.');
    if (IS_PRODUCTION) throw httpError(503, 'Phone verification is unavailable until an SMS OTP provider is configured.');
    otpChallenges.set(phone, { purpose: 'password-setup', otp: DEV_OTP, expiresAt: Date.now() + 5 * 60 * 1000 });
    return json(res, 200, { sent: true, demo: true, devOtp: DEV_OTP, expiresIn: 300 }, headers);
  }
  if (method === 'POST' && pathname === '/api/auth/complete-password-setup') {
    checkSameOrigin(req);
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    const passwordHash = hashPassword(cleanPassword(body.password));
    const challenge = otpChallenges.get(phone);
    if (!challenge || challenge.purpose !== 'password-setup' || challenge.expiresAt < Date.now() || String(body.otp || '') !== challenge.otp) throw httpError(401, 'The verification code is invalid or expired.');
    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user || user.password_hash) throw httpError(409, 'This account is already set up. Log in with your password.');
    db.prepare('UPDATE users SET password_hash = ?, verified = 1 WHERE id = ?').run(passwordHash, user.id);
    otpChallenges.delete(phone);
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const token = createSession(user.id);
    return json(res, 200, { user: userView(updatedUser) }, { ...headers, 'Set-Cookie': setSessionCookie(token) });
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    checkSameOrigin(req);
    const token = readCookie(req, 'fc_session');
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return json(res, 200, { ok: true }, { ...headers, 'Set-Cookie': 'fc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (method === 'GET' && pathname === '/api/bootstrap') {
    const user = requireUser(req);
    return json(res, 200, { user, listings: allListings(), nearbyListings: nearbyListings(user.location), orders: getOrders(user), notifications: getNotifications(user), conversations: getConversations(user), prices: getPrices(), regionalPrices: regionalPrices(user.location), requirements: user.role === 'industry' ? getRequirements(user) : [] }, headers);
  }
  if (method === 'GET' && pathname === '/api/market-prices') {
    const user = requireUser(req);
    const report = await getOfficialMarketPrices(url.searchParams.get('state') || user.state, url.searchParams.get('refresh') === '1');
    return json(res, 200, {
      records: report.records,
      total: report.total,
      sourceRecordCount: report.sourceRecordCount || 0,
      unmappedRecordCount: report.unmappedRecordCount || 0,
      marketPriceApiVersion: report.marketPriceApiVersion || 0,
      fetchedAt: new Date(report.fetchedAt).toISOString(),
      sourceUpdatedAt: report.sourceUpdatedAt,
      source: 'AGMARKNET / data.gov.in',
      priceUnit: 'Rs./Quintal',
      setupRequired: Boolean(report.setupRequired),
      message: report.message || '',
    }, headers);
  }
  if (method === 'PATCH' && pathname === '/api/notifications/read-all') {
    checkSameOrigin(req);
    const user = requireUser(req);
    db.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL').run(user.id);
    return json(res, 200, { notifications: getNotifications(user) }, headers);
  }
  const notificationReadMatch = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (method === 'PATCH' && notificationReadMatch) {
    checkSameOrigin(req);
    const user = requireUser(req);
    db.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(Number(notificationReadMatch[1]), user.id);
    return json(res, 200, { notifications: getNotifications(user) }, headers);
  }
  if (method === 'GET' && pathname === '/api/listings') return json(res, 200, { listings: allListings() }, headers);
  const listingPhotoMatch = pathname.match(/^\/api\/listings\/([A-Za-z0-9-]+)\/photo$/);
  if (listingPhotoMatch && method === 'GET') {
    const photo = db.prepare('SELECT photo_data, photo_type FROM listings WHERE id = ? AND active = 1').get(listingPhotoMatch[1]);
    if (!photo?.photo_data || !photo.photo_type) throw httpError(404, 'Crop photo not found.');
    res.writeHead(200, { ...headers, 'Content-Type': photo.photo_type, 'Content-Length': photo.photo_data.byteLength, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(photo.photo_data);
    return;
  }
  if (method === 'POST' && pathname === '/api/listings') {
    checkSameOrigin(req);
    const user = requireUser(req); requireRole(user, 'farmer');
    const body = await readJson(req);
    const crop = requireString(body.crop, 'Produce name', 100);
    const category = ['Vegetables', 'Fruits', 'Grains'].includes(body.category) ? body.category : 'Other';
    const photo = body.photoData === undefined ? { data: null, type: null } : parsePhoto(body.photoData, body.photoType);
    const location = listingLocation(body, user.location);
    const id = `FC-${randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare(`INSERT INTO listings (id, seller_id, crop, category, icon, price, unit, qty, quality, harvest, location, color, note, photo_data, photo_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, user.id, crop, category, safeIcon(body.icon), positiveNumber(body.price, 'price'), requireString(body.unit, 'Unit', 20), positiveNumber(body.qty, 'quantity'), cleanText(body.quality, 40, 'Fresh'), cleanText(body.harvest, 40, 'Today'), location, safeColor(body.color), cleanText(body.note, 1000), photo.data, photo.type);
    const listing = allListings().find((item) => item.id === id);
    return json(res, 201, { listing }, headers);
  }
  const listingMatch = pathname.match(/^\/api\/listings\/([A-Za-z0-9-]+)$/);
  if (listingMatch && method === 'PATCH') {
    checkSameOrigin(req);
    const user = requireUser(req); requireRole(user, 'farmer');
    const body = await readJson(req);
    const existing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingMatch[1]);
    if (!existing) throw httpError(404, 'Listing not found.');
    if (existing.seller_id !== user.id) throw httpError(403, 'You can only edit your own listings.');
    const category = ['Vegetables', 'Fruits', 'Grains'].includes(body.category) ? body.category : existing.category;
    const photo = body.photoData === undefined ? { data: existing.photo_data, type: existing.photo_type } : parsePhoto(body.photoData, body.photoType);
    const location = listingLocation(body, existing.location);
    db.prepare(`UPDATE listings SET crop = ?, category = ?, price = ?, unit = ?, qty = ?, quality = ?, harvest = ?, location = ?, note = ?, photo_data = ?, photo_type = ? WHERE id = ?`)
      .run(requireString(body.crop ?? existing.crop, 'Produce name', 100), category, positiveNumber(body.price ?? existing.price, 'price'), requireString(body.unit ?? existing.unit, 'Unit', 20), positiveNumber(body.qty ?? existing.qty, 'quantity'), cleanText(body.quality, 40, existing.quality), cleanText(body.harvest, 40, existing.harvest), location, cleanText(body.note, 1000, existing.note), photo.data, photo.type, existing.id);
    return json(res, 200, { listing: allListings().find((item) => item.id === existing.id) }, headers);
  }
  if (listingMatch && method === 'DELETE') {
    checkSameOrigin(req);
    const user = requireUser(req); requireRole(user, 'farmer');
    const result = db.prepare('UPDATE listings SET active = 0 WHERE id = ? AND seller_id = ?').run(listingMatch[1], user.id);
    if (!Number(result.changes)) throw httpError(404, 'Listing not found.');
    return json(res, 200, { ok: true }, headers);
  }
  const orderUpdateMatch = pathname.match(/^\/api\/orders\/([A-Za-z0-9-]+)$/);
  if (method === 'PATCH' && orderUpdateMatch) {
    checkSameOrigin(req);
    const user = requireUser(req);
    const body = await readJson(req);
    const hasStatus = typeof body.status === 'string';
    const hasPaymentStatus = typeof body.paymentStatus === 'string';
    if (hasStatus === hasPaymentStatus) throw httpError(400, 'Choose one order or payment update.');
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderUpdateMatch[1]);
    if (!order || (order.buyer_id !== user.id && order.farmer_id !== user.id)) throw httpError(404, 'Order not found.');

    if (hasStatus) {
      let kind = '';
      let recipientId;
      if (user.id === order.farmer_id && order.status === 'Payment pending' && body.status === 'In transit') {
        kind = 'order_in_transit';
        recipientId = order.buyer_id;
      } else if (user.id === order.farmer_id && order.status === 'In transit' && body.status === 'Delivered') {
        kind = 'order_delivered';
        recipientId = order.buyer_id;
      } else if (user.id === order.buyer_id && order.status === 'Delivered' && body.status === 'Completed') {
        kind = 'order_completed';
        recipientId = order.farmer_id;
      } else {
        throw httpError(409, 'That order status change is not available. Refresh the order and try again.');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare('UPDATE orders SET status = ? WHERE id = ? AND status = ?').run(body.status, order.id, order.status);
        if (Number(result.changes) !== 1) throw httpError(409, 'The order changed. Refresh and try again.');
        addNotification(recipientId, 'orders', kind, { actorName: user.name, crop: order.crop, quantity: order.qty, unit: order.unit, amount: order.total, orderId: order.id });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } else {
      if (user.id !== order.farmer_id) throw httpError(403, 'Only the farmer can record that payment was received.');
      if (body.paymentStatus !== 'paid') throw httpError(400, 'Only a received payment can be recorded.');
      if (order.payment_status === 'paid') throw httpError(409, 'This payment is already recorded as received.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ? AND payment_status != 'paid'").run(order.id);
        if (Number(result.changes) !== 1) throw httpError(409, 'The payment status changed. Refresh and try again.');
        addNotification(order.buyer_id, 'payments', 'payment_recorded', { actorName: user.name, crop: order.crop, amount: order.total, orderId: order.id });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    return json(res, 200, { order: getOrders(user).find((entry) => entry.id === order.id) }, headers);
  }
  if (method === 'POST' && pathname === '/api/orders') {
    checkSameOrigin(req);
    const user = requireUser(req);
    const body = await readJson(req);
    const order = createOrder(user, body);
    return json(res, 201, { order }, headers);
  }
  if (method === 'POST' && pathname === '/api/messages') {
    checkSameOrigin(req);
    const user = requireUser(req);
    const body = await readJson(req);
    const recipientId = Number(body.recipientId);
    const message = requireString(body.text, 'Message', 2000);
    if (!Number.isInteger(recipientId) || recipientId === user.id) throw httpError(400, 'Choose a valid conversation.');
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(recipientId)) throw httpError(404, 'User not found.');
    db.prepare('INSERT INTO messages (sender_id, recipient_id, body) VALUES (?, ?, ?)').run(user.id, recipientId, message);
    addNotification(recipientId, 'messages', 'message_received', { actorName: user.name, detail: message.slice(0, 180) });
    return json(res, 201, { ok: true }, headers);
  }
  if (method === 'POST' && pathname === '/api/requirements') {
    checkSameOrigin(req);
    const user = requireUser(req); requireRole(user, 'industry');
    const body = await readJson(req);
    const id = `REQ-${randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare('INSERT INTO requirements (id, industry_id, crop, qty, unit, needed_by, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, requireString(body.crop, 'Produce', 100), positiveNumber(body.qty, 'quantity'), requireString(body.unit, 'Unit', 20), cleanText(body.date, 40), cleanText(body.details, 1000));
    return json(res, 201, { requirement: { id, crop: body.crop, qty: Number(body.qty), unit: body.unit, date: body.date || '', matches: 0, status: 'Open', details: body.details || '' } }, headers);
  }
  if (method === 'PATCH' && pathname === '/api/profile') {
    checkSameOrigin(req);
    const user = requireUser(req);
    const body = await readJson(req);
    const name = body.name === undefined ? user.name : requireString(body.name, 'Name', 100);
    const stateName = body.state === undefined ? user.state : requireString(body.state, 'State', 80);
    const district = body.district === undefined ? user.district : requireString(body.district, 'District', 80);
    if (body.state !== undefined || body.district !== undefined) {
      if (!validRegion(stateName, district)) throw httpError(400, 'Choose a district from the selected state.');
    }
    const location = body.state !== undefined || body.district !== undefined
      ? `${district}, ${stateName}`
      : body.location === undefined ? user.location : cleanText(body.location, 120, user.location);
    const about = body.about === undefined ? user.about : cleanText(body.about, 1000);
    const language = body.language === 'hi' ? 'hi' : body.language === 'en' ? 'en' : user.language;
    const notifications = body.notifications === undefined ? (user.notifications ? 1 : 0) : (body.notifications ? 1 : 0);
    db.prepare('UPDATE users SET name = ?, location = ?, state_name = ?, district = ?, about = ?, language = ?, notifications = ? WHERE id = ?').run(name, location, stateName, district, about, language, notifications, user.id);
    return json(res, 200, { user: userView(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) }, headers);
  }
  throw httpError(404, 'API route not found.');
}

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.json', 'application/json; charset=utf-8'], ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);
const server = createServer(async (req, res) => {
  let requestUrl;
  try {
    requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (requestUrl.pathname.startsWith('/api/')) {
      await routeApi(req, res, requestUrl);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Method not allowed.');
    const filePath = publicFile(requestUrl.pathname);
    if (!filePath) throw httpError(404, 'Page not found.');
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) throw httpError(404, 'Page not found.');
    const contents = await readFile(filePath);
    res.writeHead(200, { ...securityHeaders(), 'Content-Type': MIME.get(path.extname(filePath)) || 'application/octet-stream', 'Content-Length': contents.length, 'Cache-Control': filePath.endsWith('service-worker.js') ? 'no-cache' : 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    const status = error.status || 500;
    const marketPriceRequest = requestUrl?.pathname === '/api/market-prices';
    if (status >= 500) console.error(marketPriceRequest ? `[market-prices] ${error.message}` : error);
    if (!res.headersSent) json(res, status, { error: marketPriceRequest ? error.message : status >= 500 ? 'The server could not complete that request.' : error.message }, securityHeaders());
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Farmer's Connect is running at http://${HOST}:${PORT}`);
  if (!process.env.DATA_GOV_API_KEY) console.warn('Market prices are disabled: DATA_GOV_API_KEY is not set. Copy .env.example to .env, add your personal data.gov.in API key, then restart the server.');
  console.log(IS_PRODUCTION ? 'Production mode: configure an OTP provider before enabling sign-in.' : `Development OTP: ${DEV_OTP}`);
  console.log(`SQLite database: ${DB_FILE}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
