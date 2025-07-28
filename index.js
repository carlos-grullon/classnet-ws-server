const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // ⚠️ En producción pon solo tu dominio de Vercel
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;

  if (userId) {
    socket.join(userId);
    console.log(`🔌 Usuario conectado: ${userId}`);

    socket.on('disconnect', () => {
      console.log(`❌ Usuario desconectado: ${userId}`);
    });
  }
});

app.use(express.json()); // Para leer JSON en requests POST

app.post('/send', (req, res) => {
  const { userId, notification } = req.body;

  if (!userId || !notification) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  // Emitir la notificación solo a la "sala" de ese usuario
  io.to(userId).emit('new-notification', notification);

  res.status(200).json({ message: 'Notificación enviada' });
});

app.get('/', (req, res) => {
  res.send('Socket server online ✅');
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server escuchando en http://localhost:${PORT}`);
});
