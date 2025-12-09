require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const mqtt = require("mqtt");

const app = express();

// ========= Config =========
const MONGODB_URI = process.env.MONGODB_URI; // mongodb+srv://user:pass@cluster/NhaThongMinh
const MQTT_URL = process.env.MQTT_URL || "mqtt://test.mosquitto.org:1883";
const PORT = process.env.PORT || 3000;

// ========= MongoDB =========
mongoose
  .connect(MONGODB_URI, { serverSelectionTimeoutMS: 30000 })
  .then(() => console.log("Đã kết nối MongoDB Atlas"))
  .catch((err) => console.error("Lỗi MongoDB:", err.message));

const cambienSchema = new mongoose.Schema(
  { nhietdo: Number, doam: Number, anhSang: Number },
  { timestamps: true }
);

const trangThaiSchema = new mongoose.Schema(
  { led1: Boolean, led2: Boolean, fan: Boolean, curtainMode: Number },
  { timestamps: true }
);

const CamBien = mongoose.model("CamBien", cambienSchema);
const TrangThai = mongoose.model("TrangThai", trangThaiSchema);

// ========= MQTT =========
const mqttClient = mqtt.connect(MQTT_URL, { keepalive: 30, reconnectPeriod: 2000 });

mqttClient.on("connect", () => {
  console.log("MQTT đã kết nối:", MQTT_URL);
  mqttClient.subscribe("smarthome/cambien");
  mqttClient.subscribe("home/status");
});

mqttClient.on("message", async (topic, payload) => {
  try {
    const msg = payload.toString();

    if (topic === "smarthome/cambien") {
      const data = JSON.parse(msg);
      if (typeof data?.nhietdo === "number") {
        await CamBien.create(data);
        console.log("Lưu CamBien:", data);
      }
      return;
    }

    if (topic === "home/status") {
      const status = JSON.parse(msg);
      await TrangThai.findOneAndUpdate({}, { $set: status }, { upsert: true, new: true });
      console.log("Cập nhật TrangThai:", status);
      return;
    }
  } catch (err) {
    console.error("Lỗi xử lý MQTT:", err.message);
  }
});

// ========= Express =========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ========= REST APIs =========
app.get("/api/cambien/latest", async (req, res) => {
  try {
    const doc = await CamBien.findOne().sort({ createdAt: -1 });
    res.json(doc || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/cambien/recent", async (req, res) => {
  try {
    const docs = await CamBien.find().sort({ createdAt: -1 }).limit(10);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/trangthai/latest", async (req, res) => {
  try {
    const doc = await TrangThai.findOne();
    res.json(doc || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gửi lệnh điều khiển
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
