const mqtt = require("mqtt");

// Konfigurasi alamat broker MQTT HiveMQ Cloud
const brokerUrl =
  "mqtt://b639948b5012452ea0da4f2c97fd31f9.s1.eu.hivemq.cloud:1883";
const options = {
  username: "nodus",
  password: "#Aryanta4321",
  clientId: "Nodus_Backend_Processor",
};

const client = mqtt.connect(brokerUrl, options);

client.on("connect", () => {
  console.log("[SISTEM] Peladen Backend berhasil terhubung ke HiveMQ Broker.");

  // Berlangganan ke topik koordinat secara universal menggunakan wildcard (+)
  client.subscribe("nodus/tracking/+", (err) => {
    if (!err) {
      console.log(
        "[SISTEM] Berhasil berlangganan ke seluruh saluran tracking perangkat.",
      );
    }
  });
});

client.on("message", (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());

    // Validasi integritas data spasial sebelum diproses
    if (payload.id && payload.lat && payload.lng && payload.alt) {
      console.log(
        `[DATA MASUK] Perangkat ID: ${payload.id} | Garis Lintang: ${payload.lat} | Garis Bujur: ${payload.lng} | Ketinggian: ${payload.alt} MDPL`,
      );

      // Logika penyimpanan data ke basis data jangka panjang dapat diintegrasikan di bagian ini
    }
  } catch (error) {
    console.error(
      "[GALAT] Format payload data tidak valid atau rusak:",
      error.message,
    );
  }
});

client.on("error", (err) => {
  console.error(
    "[GALAT NETWOK] Kegagalan koneksi pada broker MQTT:",
    err.message,
  );
});
