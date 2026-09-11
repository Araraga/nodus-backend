const fs = require("fs");
const path = require("path");

// Buat direktori logs jika belum tersedia
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const trackingLogPath = path.join(logsDir, "tracking.log");
const systemLogPath = path.join(logsDir, "system.log");

// Buffer memori untuk menyimpan log terbaru (dapat diakses via API /api/logs)
const recentLogs = [];
const MAX_RECENT_LOGS = 200;

function appendToMemory(type, message) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    message,
  };
  recentLogs.push(entry);
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.shift();
  }
}

function logTracking(deviceId, lat, lng, alt) {
  const now = new Date().toISOString();
  const logLine = `[${now}] [GPS_TRACK] ID: ${deviceId} | Lat: ${lat.toFixed(6)} | Lng: ${lng.toFixed(6)} | Alt: ${alt} MDPL\n`;

  // 1. Tampilkan ke console (otomatis dicatat oleh PM2)
  console.log(`[DATA MASUK] Perangkat ID: ${deviceId} | Lintang: ${lat} | Bujur: ${lng} | Ketinggian: ${alt} MDPL`);

  // 2. Simpan ke file logs/tracking.log
  fs.appendFile(trackingLogPath, logLine, (err) => {
    if (err) console.error("[LOGGER] Gagal menulis ke tracking.log:", err.message);
  });

  // 3. Simpan ke ring buffer memori
  appendToMemory("GPS_DATA", { deviceId, lat, lng, alt });
}

function logSystem(message, level = "INFO") {
  const now = new Date().toISOString();
  const logLine = `[${now}] [${level}] ${message}\n`;

  if (level === "ERROR") {
    console.error(`[GALAT] ${message}`);
  } else {
    console.log(`[SISTEM] ${message}`);
  }

  fs.appendFile(systemLogPath, logLine, (err) => {
    if (err) console.error("[LOGGER] Gagal menulis ke system.log:", err.message);
  });

  appendToMemory(level, message);
}

function getRecentLogs() {
  return recentLogs;
}

module.exports = {
  logTracking,
  logSystem,
  getRecentLogs,
};
