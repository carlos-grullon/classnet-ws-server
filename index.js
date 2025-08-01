require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Configuración básica
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = '*';  // Puedes cambiar esto por dominios específicos si quieres

// Crear app Express y aplicar CORS
const app = express();
app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json()); // Para parsear JSON en requests

// Crear servidor HTTP con Express
const server = http.createServer(app);

// Configurar Socket.IO con CORS
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Guardar usuarios conectados en memoria (userId -> socketId)
const connectedUsers = new Map();

// Middleware para validar y registrar usuario en socket
io.use((socket, next) => {
  const { userId, socketKey } = socket.handshake.query;

  // Validar que venga userId y la key de socket (SOCKET_KEY)
  if (!userId) return next(new Error('Se requiere userId'));
  if (socketKey !== process.env.SOCKET_KEY) return next(new Error('Clave de socket inválida'));

  // Registrar usuario conectado
  connectedUsers.set(userId, socket.id);
  console.log(`Usuario conectado: ${userId} (${socket.id})`);

  // Unir al usuario a una sala personal con su userId
  socket.join(userId);

  next();
});

// Manejo de conexiones
io.on('connection', (socket) => {
  const { userId } = socket.handshake.query;

  // Enviar evento confirmando conexión exitosa
  socket.emit('connection', {
    success: true,
    message: 'Conexión establecida',
    userId,
    timestamp: new Date().toISOString()
  });

  // Escuchar desconexión para limpiar usuarios conectados
  socket.on('disconnect', (reason) => {
    console.log(`Usuario desconectado: ${userId} (${socket.id}) - Razón: ${reason}`);
    connectedUsers.delete(userId);
  });

  // Escuchar evento para verificar si otro usuario está en línea
  socket.on('check-online', (data, callback) => {
    const { targetUserId } = data;
    const isOnline = connectedUsers.has(targetUserId);
    callback({ isOnline });
  });
});

// Endpoint HTTP para enviar eventos a usuarios conectados vía socket
app.post('/emit', express.json(), (req, res) => {
  const internalKey = req.headers['x-internal-key'];

  if (internalKey !== process.env.SOCKET_KEY) {
    return res.status(403).json({ error: 'Acceso no autorizado' });
  }

  const { userId, eventType, payload } = req.body;

  if (!userId || !eventType || !payload) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  io.to(userId).emit(eventType, payload);

  res.json({ success: true });
});

// Ruta simple para verificar que el servidor está activo
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: connectedUsers.size
  });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
