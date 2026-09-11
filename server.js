require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mqtt = require("mqtt");
const db = require("./db");
const { logTracking, logSystem, getRecentLogs } = require("./logger");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Status state sistem
let mqttConnected = false;
const startTime = Date.now();

// ==========================================
// 1. KONEKSI BROKER MQTT (HiveMQ Cloud TLS)
// ==========================================
const brokerUrl =
  process.env.MQTT_BROKER_URL ||
  "mqtts://b639948b5012452ea0da4f2c97fd31f9.s1.eu.hivemq.cloud:8883";

const mqttOptions = {
  username: process.env.MQTT_USERNAME || "nodus",
  password: process.env.MQTT_PASSWORD || "nodus1234",
  clientId:
    process.env.MQTT_CLIENT_ID ||
    "Nodus_Backend_" + Math.random().toString(16).substring(2, 8),
  rejectUnauthorized: false,
  reconnectPeriod: 5000,
  connectTimeout: 30 * 1000,
};

logSystem(`Memulai inisialisasi peladen Nodus Backend...`, "INFO");
logSystem(`Broker MQTT Target: ${brokerUrl}`, "INFO");

const mqttClient = mqtt.connect(brokerUrl, mqttOptions);

mqttClient.on("connect", () => {
  mqttConnected = true;
  logSystem("Peladen Backend berhasil terhubung ke HiveMQ Broker via TLS.", "INFO");

  mqttClient.subscribe("nodus/tracking/+", { qos: 1 }, (err) => {
    if (!err) {
      logSystem("Berhasil berlangganan ke saluran 'nodus/tracking/+'", "INFO");
    } else {
      logSystem(`Gagal berlangganan topik: ${err.message}`, "ERROR");
    }
  });
});

mqttClient.on("reconnect", () => {
  logSystem("Mencoba menyambungkan kembali ke Broker MQTT...", "WARN");
});

mqttClient.on("offline", () => {
  mqttConnected = false;
  logSystem("Koneksi ke Broker MQTT terputus (Offline).", "WARN");
});

mqttClient.on("error", (err) => {
  mqttConnected = false;
  logSystem(`Kegagalan koneksi broker MQTT: ${err.message}`, "ERROR");
});

mqttClient.on("message", async (topic, message) => {
  try {
    const rawStr = message.toString();
    const payload = JSON.parse(rawStr);

    const deviceId = payload.id ? String(payload.id).trim() : null;
    const lat = typeof payload.lat === "number" ? payload.lat : parseFloat(payload.lat);
    const lng = typeof payload.lng === "number" ? payload.lng : parseFloat(payload.lng);
    const alt = typeof payload.alt === "number" ? payload.alt : parseFloat(payload.alt || 0);

    if (deviceId && !isNaN(lat) && !isNaN(lng)) {
      logTracking(deviceId, lat, lng, alt);
      const dbSaved = await db.saveTrackingData(deviceId, lat, lng, alt, payload);
      if (!dbSaved) {
        logSystem(`Peringatan: Gagal menyimpan data untuk device ${deviceId} ke database.`, "WARN");
      }
    } else {
      logSystem(`Payload tidak valid diterima di topik ${topic}: ${rawStr}`, "WARN");
    }
  } catch (error) {
    logSystem(`Format payload rusak atau gagal diproses: ${error.message}`, "ERROR");
  }
});

// ==========================================
// 2. HTTP REST API ENDPOINTS
// ==========================================

// Endpoint Status & Healthcheck
app.get("/", async (req, res) => {
  const dbStats = await db.getDatabaseStats();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  res.json({
    name: "Nodus IoT Tracking Backend Server",
    version: "2.0.0",
    status: "online",
    uptime: `${uptimeSeconds} detik`,
    mqtt: {
      connected: mqttConnected,
      broker: brokerUrl,
    },
    database: dbStats,
    timestamp: new Date().toISOString(),
  });
});

// Endpoint Daftar Seluruh Perangkat yang Terdeteksi
app.get("/api/devices", async (req, res) => {
  try {
    const devices = await db.getAllDevices();
    res.json({
      success: true,
      count: devices.length,
      data: devices,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint Koordinat Terakhir Perangkat Berdasarkan ID
app.get("/api/tracking/:id", async (req, res) => {
  try {
    const deviceId = req.params.id;
    const device = await db.getDeviceLatest(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        message: `Perangkat dengan ID '${deviceId}' tidak ditemukan dalam basis data.`,
      });
    }
    res.json({
      success: true,
      data: device,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint Riwayat Jejak Jalur Perangkat (Historical Breadcrumbs)
app.get("/api/tracking/:id/history", async (req, res) => {
  try {
    const deviceId = req.params.id;
    const limit = req.query.limit || 100;
    const history = await db.getDeviceHistory(deviceId, limit);
    res.json({
      success: true,
      deviceId,
      count: history.length,
      data: history,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint Log Riwayat Sistem & Data Masuk
app.get("/api/logs", (req, res) => {
  res.json({
    success: true,
    data: getRecentLogs(),
  });
});

// Endpoint Webhook HTTP (untuk pengujian atau kirim data via HTTP POST)
app.post("/api/tracking", async (req, res) => {
  try {
    const { id, lat, lng, alt } = req.body;
    if (!id || lat === undefined || lng === undefined) {
      return res.status(400).json({
        success: false,
        message: "Format wajib: { id, lat, lng, alt }",
      });
    }

    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const numAlt = parseFloat(alt || 0);

    logTracking(String(id), numLat, numLng, numAlt);
    await db.saveTrackingData(String(id), numLat, numLng, numAlt, req.body);

    // Siarkan ke Broker HiveMQ agar aplikasi mobile nodus_mobile langsung terupdate secara real-time
    if (mqttConnected && mqttClient) {
      mqttClient.publish(
        `nodus/tracking/${id}`,
        JSON.stringify({ id: String(id), lat: numLat, lng: numLng, alt: numAlt }),
        { qos: 1 }
      );
    }

    res.json({
      success: true,
      message: "Data tracking berhasil disimpan ke basis data dan disiarkan ke MQTT.",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 3. START SERVER & INISIALISASI DB
// ==========================================
async function startServer() {
  await db.initDB();

  app.listen(PORT, "0.0.0.0", () => {
    logSystem(`Server HTTP Nodus Backend aktif mendengarkan di port ${PORT}`, "INFO");
    logSystem(`Akses API: http://38.103.170.74:${PORT}/`, "INFO");
  });
}

startServer();

process.on("SIGINT", () => {
  logSystem("Menerima sinyal SIGINT. Mematikan peladen dengan aman...", "INFO");
  if (mqttClient) mqttClient.end();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logSystem("Menerima sinyal SIGTERM. Mematikan peladen dengan aman...", "INFO");
  if (mqttClient) mqttClient.end();
  process.exit(0);
});

