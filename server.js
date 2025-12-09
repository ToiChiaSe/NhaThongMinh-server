require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const mqtt = require("mqtt");

const app = express();

// ========= Config =========
const MONGODB_URI = process.env.MONGODB_URI;
const MQTT_URL = process.env.MQTT_URL || "mqtt://test.mosquitto.org:1883";
const PORT = process.env.PORT || 3000;

// ========= MongoDB =========
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 30000 })
  .then(() => console.log("Đã kết nối MongoDB Atlas"))
  .catch(err => console.error("Lỗi MongoDB:", err.message));

const cambienSchema = new mongoose.Schema(
  { nhietdo: Number, doam: Number, anhSang: Number },
  { timestamps: true }
);

const trangThaiSchema = new mongoose.Schema(
  { led1: Boolean, led2: Boolean, led3: Boolean, led4: Boolean, fan: Boolean, curtainMode: Number, encRem: Number, encQuat: Number },
  { timestamps: true }
);

const CamBien = mongoose.model("CamBien", cambienSchema);
const TrangThai = mongoose.model("TrangThai", trangThaiSchema);

// ========= MQTT =========
const mqttClient = mqtt.connect(MQTT_URL, { keepalive: 30, reconnectPeriod: 2000 });

mqttClient.on("connect", () => {
  console.log("MQTT đã kết nối:", MQTT_URL);
  mqttClient.subscribe("truong/home/cambien");
  mqttClient.subscribe("truong/home/status");
});

mqttClient.on("message", async (topic, payload) => {
  const msg = payload.toString();
  try {
    const data = JSON.parse(msg);

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      console.warn(" Bỏ qua payload không hợp lệ:", msg);
      return;
    }

    if (data.deviceId !== "esp32-001") {
      console.warn(" Bỏ qua payload từ thiết bị khác:", data.deviceId);
      return;
    }
    delete data.deviceId;

    if (topic === "truong/home/cambien") {
      await CamBien.create(data);
      console.log(" Lưu CamBien:", data);
    }

    if (topic === "truong/home/status") {
      await TrangThai.findOneAndUpdate({}, { $set: data }, { upsert: true, new: true });
      console.log(" Cập nhật TrangThai:", data);
    }
  } catch (err) {
    console.error(" Lỗi xử lý MQTT:", err.message, "Payload:", msg);
  }
});

// ========= Express =========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // phục vụ dashboard

// ========= REST APIs =========
app.get("/api/cambien/latest", async (req, res) => {
  const doc = await CamBien.findOne().sort({ createdAt: -1 });
  res.json(doc || {});
});

app.get("/api/cambien/recent", async (req, res) => {
  const docs = await CamBien.find().sort({ createdAt: -1 }).limit(10);
  res.json(docs);
});

app.get("/api/trangthai/latest", async (req, res) => {
  const doc = await TrangThai.findOne();
  res.json(doc || {});
});

// ========= API điều khiển =========
app.post("/api/cmd", (req, res) => {
  const { topic, cmd } = req.body || {};
  if (!topic || typeof cmd !== "string") {
    return res.status(400).json({ error: "Thiếu topic hoặc cmd" });
  }
  mqttClient.publish(topic, cmd, { qos: 0 }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    console.log(` Publish CMD: ${topic} -> ${cmd}`);
    res.json({ success: true });
  });
});

// ========= Start server =========
app.listen(PORT, () => {
  console.log(`🌐 WebServer chạy tại http://localhost:${PORT}`);
});
