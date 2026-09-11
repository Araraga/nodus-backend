const { Pool } = require("pg");
const { logSystem } = require("./logger");

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://nodus:nodus1234@127.0.0.1:5432/nodus_db";

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let isConnected = false;

pool.on("error", (err) => {
  logSystem(`Database pool error: ${err.message}`, "ERROR");
  isConnected = false;
});

async function initDB() {
  try {
    const client = await pool.connect();
    isConnected = true;
    logSystem("Koneksi ke basis data PostgreSQL berhasil dibangun.", "INFO");

    // 1. Buat tabel master perangkat (devices)
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(100),
        last_lat DOUBLE PRECISION,
        last_lng DOUBLE PRECISION,
        last_alt DOUBLE PRECISION,
        total_packets BIGINT DEFAULT 1,
        last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Buat tabel riwayat log koordinat GPS (tracking_logs)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tracking_logs (
        id BIGSERIAL PRIMARY KEY,
        device_id VARCHAR(64) NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        altitude DOUBLE PRECISION DEFAULT 0,
        raw_payload TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Buat indeks untuk optimasi performa pencarian spasial dan riwayat waktu
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tracking_logs_device_id ON tracking_logs(device_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_logs_created_at ON tracking_logs(created_at DESC);
    `);

    client.release();
    logSystem("Skema tabel basis data Nodus berhasil diverifikasi / diinisialisasi.", "INFO");
    return true;
  } catch (error) {
    isConnected = false;
    logSystem(`Gagal inisialisasi basis data: ${error.message}`, "ERROR");
    return false;
  }
}

async function saveTrackingData(deviceId, lat, lng, alt, rawPayload = null) {
  if (!isConnected) {
    // Coba re-inisialisasi koneksi jika sebelumnya gagal
    const ok = await initDB();
    if (!ok) {
      logSystem(`Penyimpanan data ${deviceId} ditunda: Basis data tidak terhubung.`, "WARN");
      return false;
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Upsert perangkat ke tabel devices (perbarui koordinat terakhir dan hitungan paket)
    const upsertDeviceQuery = `
      INSERT INTO devices (device_id, last_lat, last_lng, last_alt, total_packets, last_seen)
      VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP)
      ON CONFLICT (device_id) DO UPDATE SET
        last_lat = EXCLUDED.last_lat,
        last_lng = EXCLUDED.last_lng,
        last_alt = EXCLUDED.last_alt,
        total_packets = devices.total_packets + 1,
        last_seen = CURRENT_TIMESTAMP;
    `;
    await client.query(upsertDeviceQuery, [deviceId, lat, lng, alt]);

    // Simpan titik spasial ke histori tracking_logs
    const insertLogQuery = `
      INSERT INTO tracking_logs (device_id, latitude, longitude, altitude, raw_payload)
      VALUES ($1, $2, $3, $4, $5);
    `;
    await client.query(insertLogQuery, [
      deviceId,
      lat,
      lng,
      alt,
      rawPayload ? JSON.stringify(rawPayload) : null,
    ]);

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    logSystem(`Gagal menyimpan data tracking ke DB: ${error.message}`, "ERROR");
    return false;
  } finally {
    client.release();
  }
}

async function getAllDevices() {
  if (!isConnected) return [];
  try {
    const res = await pool.query("SELECT * FROM devices ORDER BY last_seen DESC");
    return res.rows;
  } catch (error) {
    logSystem(`Error query getAllDevices: ${error.message}`, "ERROR");
    return [];
  }
}

async function getDeviceLatest(deviceId) {
  if (!isConnected) return null;
  try {
    const res = await pool.query("SELECT * FROM devices WHERE device_id = $1", [deviceId]);
    return res.rows[0] || null;
  } catch (error) {
    logSystem(`Error query getDeviceLatest: ${error.message}`, "ERROR");
    return null;
  }
}

async function getDeviceHistory(deviceId, limit = 100) {
  if (!isConnected) return [];
  try {
    const parsedLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 1000);
    const query = `
      SELECT id, device_id, latitude, longitude, altitude, created_at
      FROM (
        SELECT id, device_id, latitude, longitude, altitude, created_at
        FROM tracking_logs
        WHERE device_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      ) sub
      ORDER BY created_at ASC;
    `;
    const res = await pool.query(query, [deviceId, parsedLimit]);
    return res.rows;
  } catch (error) {
    logSystem(`Error query getDeviceHistory: ${error.message}`, "ERROR");
    return [];
  }
}

async function getDatabaseStats() {
  if (!isConnected) return { connected: false };
  try {
    const deviceCountRes = await pool.query("SELECT COUNT(*) AS count FROM devices");
    const logCountRes = await pool.query("SELECT COUNT(*) AS count FROM tracking_logs");
    return {
      connected: true,
      totalDevices: parseInt(deviceCountRes.rows[0].count),
      totalLogs: parseInt(logCountRes.rows[0].count),
    };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

module.exports = {
  initDB,
  saveTrackingData,
  getAllDevices,
  getDeviceLatest,
  getDeviceHistory,
  getDatabaseStats,
};
