// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const mqtt = require("mqtt");

const app = express();

// ========= Config =========
// Lấy từ biến môi trường (Render Dashboard → Environment)
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://<user>:<pass>@<cluster>/<db>?retryWrites=true&w=majority";
const MQTT_URL = process.env.MQTT_URL || "mqtt://test.mosquitto.org:1883";
const PORT = process.env.PORT || 3000;

// ========= MongoDB =========
mongoose
  .connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log("Đã kết nối MongoDB Atlas"))
  .catch((err) => console.error("Lỗi MongoDB:", err.message));

const cambienSchema = new mongoose.Schema(
  {
    nhietdo: Number,
    doam: Number,
    anhSang: Number,
  },
  { timestamps: true }
);

const trangThaiSchema = new mongoose.Schema(
  {
    led1: Boolean,
    led2: Boolean,
    fan: Boolean,
    curtainMode: Number, // ví dụ: 0-đóng, 1-mở, 2-dừng
  },
  { timestamps: true }
);

const CamBien = mongoose.model("CamBien", cambienSchema);
const TrangThai = mongoose.model("TrangThai", trangThaiSchema);

// ========= MQTT =========
const mqttClient = mqtt.connect(MQTT_URL, {
  // Giữ kết nối ổn định trên Render
  keepalive: 30,
  reconnectPeriod: 2000,
});

mqttClient.on("connect", () => {
  console.log("MQTT đã kết nối:", MQTT_URL);
  // Subscribe dữ liệu cảm biến từ ESP32 (JSON)
  mqttClient.subscribe("smarthome/cambien", (err) => {
    if (!err) console.log("Subscribed: smarthome/cambien");
  });

  // Subscribe trạng thái thiết bị
  mqttClient.subscribe("home/status/led1");
  mqttClient.subscribe("home/status/led2");
  mqttClient.subscribe("home/status/fan");
  mqttClient.subscribe("home/status/curtain");
  console.log("Subscribed: home/status/*");
});

mqttClient.on("error", (err) => {
  console.error("MQTT error:", err.message);
});

mqttClient.on("message", async (topic, payload) => {
  try {
    const msg = payload.toString();

    // Cảm biến: ESP32 publish JSON { nhietdo, doam, anhSang }
    if (topic === "smarthome/cambien") {
      const data = JSON.parse(msg);
      if (
        typeof data?.nhietdo === "number" &&
        typeof data?.doam === "number" &&
        typeof data?.anhSang === "number"
      ) {
        await CamBien.create(data);
        console.log("Lưu CamBien:", data);
      } else {
        console.warn("Dữ liệu cảm biến không hợp lệ:", data);
      }
      return;
    }

    // Trạng thái thiết bị: các topic riêng
    if (topic.startsWith("home/status/")) {
      const update = {};
      if (topic === "home/status/led1") update.led1 = msg === "ON";
      if (topic === "home/status/led2") update.led2 = msg === "ON";
      if (topic === "home/status/fan") update.fan = msg === "ON";
      if (topic === "home/status/curtain") update.curtainMode = parseInt(msg);

      // Chỉ lưu các trường có giá trị
      if (Object.keys(update).length) {
        await TrangThai.create(update);
        console.log("Lưu TrangThai:", update);
      }
      return;
    }
  } catch (err) {
    console.error("Lỗi xử lý MQTT message:", err.message);
  }
});

// ========= Express static & middleware =========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ========= REST APIs =========

// Dữ liệu cảm biến mới nhất
app.get("/api/cambien/latest", async (req, res) => {
  try {
    const doc = await CamBien.findOne().sort({ createdAt: -1 });
    res.json(doc || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trạng thái thiết bị mới nhất
app.get("/api/trangthai/latest", async (req, res) => {
  try {
    const doc = await TrangThai.findOne().sort({ createdAt: -1 });
    res.json(doc || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gửi lệnh điều khiển từ dashboard → MQTT
// body: { topic: "home/cmd/led1", cmd: "ON" }
app.post("/api/cmd", (req, res) => {
  const { topic, cmd } = req.body || {};
  if (!topic || typeof cmd !== "string") {
    return res.status(400).json({ error: "Thiếu topic hoặc cmd" });
  }
  mqttClient.publish(topic, cmd, { qos: 0 }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    console.log(`Publish CMD: ${topic} -> ${cmd}`);
    res.json({ success: true });
  });
});

// ========= Start server =========
app.listen(PORT, () => {
  console.log(`WebServer chạy tại http://localhost:${PORT}`);
});
