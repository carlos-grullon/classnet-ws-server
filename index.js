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

app.get('/', (req, res) => {
  res.send('Socket server online ✅');
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server escuchando en http://localhost:${PORT}`);
});
