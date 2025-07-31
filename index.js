require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Configuración
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS = '*';

// Inicialización de Express
const app = express();
app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

// Crear servidor HTTP
const server = http.createServer(app);

// Configuración de Socket.IO
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutos
    skipMiddlewares: true
  }
});

// Almacén en memoria para usuarios conectados
const connectedUsers = new Map(); // userId -> socketId

/**
 * Middleware para autenticación de sockets
 */
const authenticateSocket = (socket, next) => {
  const { userId } = socket.handshake.query;
  
  if (!userId) {
    console.warn('⚠️ Intento de conexión sin userId');
    return next(new Error('Se requiere userId'));
  }
  
  // Guardar referencia del usuario
  connectedUsers.set(userId, socket.id);
  console.log(`🔌 Usuario conectado: ${userId} (${socket.id})`);
  
  // Unir al usuario a su sala personal
  socket.join(userId);
  
  // Informar al usuario que está conectado
  socket.emit('connection', { 
    success: true, 
    message: 'Conexión establecida',
    userId,
    timestamp: new Date().toISOString()
  });
  
  next();
};

// Configurar eventos de conexión
io.use(authenticateSocket);

io.on('connection', (socket) => {
  const { userId } = socket.handshake.query;
  
  // Manejar desconexión
  socket.on('disconnect', (reason) => {
    console.log(`❌ Usuario desconectado: ${userId} (${socket.id}) - Razón: ${reason}`);
    connectedUsers.delete(userId);
  });
  
  // Manejar errores
  socket.on('error', (error) => {
    console.error(`❌ Error en socket ${socket.id} (${userId}):`, error);
  });
  
  // Evento para verificar si el usuario está en línea
  socket.on('check-online', (data, callback) => {
    const { targetUserId } = data;
    const isOnline = connectedUsers.has(targetUserId);
    callback({ isOnline });
  });
});

/**
 * Ruta para enviar eventos a través de HTTP
 * Compatible con el servicio WebSocketService
 */
app.post('/events', async (req, res) => {
  try {
    const eventData = req.body;
    const { userId, eventType, payload } = eventData;
    
    if (!userId || !eventType) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren userId y eventType',
        metadata: { timestamp: new Date().toISOString() }
      });
    }
    
    // Verificar si el usuario está conectado
    const isUserOnline = connectedUsers.has(userId);
    
    // Enviar el evento al usuario específico
    io.to(userId).emit(eventType, { 
      ...payload,
      metadata: {
        ...(payload?.metadata || {}),
        sentAt: new Date().toISOString(),
        received: isUserOnline
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'Evento enviado correctamente',
      metadata: {
        eventType,
        timestamp: new Date().toISOString(),
        delivered: isUserOnline,
        recipientCount: isUserOnline ? 1 : 0
      }
    });
    
  } catch (error) {
    console.error('❌ Error al procesar evento:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      metadata: {
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Ruta de verificación de estado
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connections: connectedUsers.size
  });
});

// Ruta raíz
app.get('/', (req, res) => {
  res.send(`
    <h1>WebSocket Server</h1>
    <p>Estado: <strong>En línea</strong></p>
    <p>Usuarios conectados: <strong>${connectedUsers.size}</strong></p>
    <p>Modo: <strong>${NODE_ENV}</strong></p>
    <p>Orígenes permitidos: <strong>${Array.isArray(ALLOWED_ORIGINS) ? ALLOWED_ORIGINS.join(', ') : ALLOWED_ORIGINS}</strong></p>
  `);
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err);
  res.status(500).json({
    success: false,
    error: 'Error interno del servidor',
    metadata: {
      timestamp: new Date().toISOString()
    }
  });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor WebSocket escuchando en puerto ${PORT}`);
  console.log(`🌍 Modo: ${NODE_ENV}`);
  console.log(`🔗 Orígenes permitidos: ${Array.isArray(ALLOWED_ORIGINS) ? ALLOWED_ORIGINS.join(', ') : ALLOWED_ORIGINS}`);
});

// Manejo de cierre limpio
process.on('SIGTERM', () => {
  console.log('🛑 Recibida señal SIGTERM. Cerrando servidor...');
  server.close(() => {
    console.log('👋 Servidor cerrado');
    process.exit(0);
  });
});
