import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import mongoose from 'mongoose';
import mqtt from 'mqtt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const MONGO_URL = "mongodb+srv://h13q03t03_db_user:ToiLaAi123@truong.dqw3eoo.mongodb.net/NhaThongMinh?retryWrites=true&w=majority";
const MQTT_URL = 'mqtt://test.mosquitto.org:1883';

const app = express();
app.use(cors());
app.use(express.json());

// ===== Kết nối MongoDB =====
mongoose.connect(MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Kết nối MongoDB thành công:', MONGO_URL))
  .catch(err => console.error('Lỗi MongoDB:', err.message));

// ===== Schema =====
const Cambien = mongoose.model('Cambien', new mongoose.Schema({
  temp: Number,
  hum: Number,
  light: Number,
  timestamp: { type: Date, default: Date.now }
}, { collection: 'cambien' }));

const Trangthai = mongoose.model('Trangthai', new mongoose.Schema({
  led1: Boolean, led2: Boolean, led3: Boolean, led4: Boolean,
  fan: Boolean, curtainMode: Number,
  encRem: Number, encQuat: Number,
  timestamp: { type: Date, default: Date.now }
}, { collection: 'trangthai' }));

// ===== MQTT =====
const client = mqtt.connect(MQTT_URL);
client.on('connect', () => {
  console.log('MQTT đã kết nối:', MQTT_URL);
  client.subscribe('home/sensors/temp');
  client.subscribe('home/sensors/hum');
  client.subscribe('home/sensors/light');
  client.subscribe('home/status/all');
});

client.on('message', async (topic, message) => {
  const payload = message.toString();
  try {
    if (topic.startsWith('home/sensors')) {
      const last = await Cambien.findOne().sort({ timestamp: -1 });
      const base = { temp: last?.temp ?? null, hum: last?.hum ?? null, light: last?.light ?? null };
      if (topic.endsWith('/temp'))  base.temp  = parseFloat(payload);
      if (topic.endsWith('/hum'))   base.hum   = parseFloat(payload);
      if (topic.endsWith('/light')) base.light = parseFloat(payload);
      await Cambien.create(base);
      console.log("Lưu cảm biến:", base);
    } else if (topic === 'home/status/all') {
      const doc = JSON.parse(payload);
      await Trangthai.create(doc);
      console.log("Lưu trạng thái:", doc);
    }
  } catch (err) {
    console.error("Lỗi lưu:", err.message);
  }
});

// ===== API =====
app.get('/api/cambien/latest', async (req, res) => {
  const latest = await Cambien.findOne().sort({ timestamp: -1 });
  res.json(latest ?? {});
});
app.get('/api/cambien/history', async (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  const history = await Cambien.find().sort({ timestamp: -1 }).limit(limit);
  res.json(history);
});
app.get('/api/trangthai/latest', async (req, res) => {
  const latest = await Trangthai.findOne().sort({ timestamp: -1 });
  res.json(latest ?? {});
});
app.get('/api/trangthai/history', async (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  const history = await Trangthai.find().sort({ timestamp: -1 }).limit(limit);
  res.json(history);
});

// ===== Dashboard =====
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`WebServer chạy tại http://localhost:${PORT}`));
