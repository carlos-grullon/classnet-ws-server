require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Configuración de logs
const logger = {
  info: (message, data = {}) => console.log(`[INFO] ${new Date().toISOString()} - ${message}`, Object.keys(data).length ? data : ''),
  error: (message, error = null) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error ? error.stack || error : '');
  },
  warn: (message, data = {}) => console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, data)
};

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
  try {
    const { userId, socketKey } = socket.handshake.query;
    logger.info('Nueva conexión entrante', { socketId: socket.id, userId });

    // Validar que venga userId y la key de socket (SOCKET_KEY)
    if (!userId) {
      const error = new Error('Se requiere userId');
      logger.error('Error en validación de conexión', error);
      return next(error);
    }
    
    if (socketKey !== process.env.SOCKET_KEY) {
      const error = new Error('Clave de socket inválida');
      logger.error('Error de autenticación', { socketId: socket.id, userId });
      return next(error);
    }

    // Registrar usuario conectado
    connectedUsers.set(userId, socket.id);
    logger.info('Usuario conectado exitosamente', { userId, socketId: socket.id });

    // Unir al usuario a una sala personal con su userId
    socket.join(userId);
    next();
  } catch (error) {
    logger.error('Error en middleware de conexión', error);
    next(error);
  }
});

// Manejo de conexiones
io.on('connection', (socket) => {
  try {
    const { userId } = socket.handshake.query;
    logger.info('Manejando nueva conexión', { userId, socketId: socket.id });

    // Enviar evento confirmando conexión exitosa
    const connectionAck = {
      success: true,
      message: 'Conexión establecida',
      userId,
      timestamp: new Date().toISOString()
    };
    
    socket.emit('connection', connectionAck);
    logger.info('Confirmación de conexión enviada', { userId, socketId: socket.id });

    // Escuchar desconexión para limpiar usuarios conectados
    socket.on('disconnect', (reason) => {
      try {
        logger.info('Usuario desconectado', { 
          userId, 
          socketId: socket.id, 
          reason,
          connectedUsersCount: connectedUsers.size - 1 // Mostrará el nuevo tamaño después de la desconexión
        });
        connectedUsers.delete(userId);
      } catch (error) {
        logger.error('Error al manejar desconexión', { error, userId, socketId: socket.id });
      }
    });

    // Escuchar evento para verificar si otro usuario está en línea
    socket.on('check-online', (data, callback) => {
      try {
        if (!data || typeof data !== 'object') {
          throw new Error('Datos de solicitud inválidos');
        }
        
        const { targetUserId } = data;
        if (!targetUserId) {
          throw new Error('Se requiere targetUserId');
        }
        
        const isOnline = connectedUsers.has(targetUserId);
        logger.info('Verificación de usuario en línea', { 
          requestedBy: userId, 
          targetUserId, 
          isOnline 
        });
        
        callback({ 
          success: true, 
          isOnline,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error('Error en check-online', { 
          error: error.message, 
          userId, 
          data 
        });
        callback({ 
          success: false, 
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });
  } catch (error) {
    logger.error('Error en el manejador de conexión', { 
      error, 
      socketId: socket?.id,
      userId: socket?.handshake?.query?.userId 
    });
  }
});

// Endpoint HTTP para enviar eventos a usuarios conectados vía socket
app.post('/emit', express.json(), (req, res) => {
  const requestId = Math.random().toString(36).substring(2, 9);
  
  try {
    logger.info('Nueva solicitud de emisión recibida', { requestId, path: req.path });
    
    const internalKey = req.headers['x-internal-key'];
    if (internalKey !== process.env.SOCKET_KEY) {
      logger.warn('Intento de acceso no autorizado', { 
        requestId, 
        ip: req.ip,
        headers: JSON.stringify(req.headers) 
      });
      return res.status(403).json({ 
        success: false,
        error: 'Acceso no autorizado',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    const { userId, eventType, payload } = req.body;
    logger.info('Datos de solicitud recibidos', { 
      requestId, 
      userId, 
      eventType,
      payloadSize: JSON.stringify(payload)?.length || 0 
    });

    if (!userId || !eventType || !payload) {
      const error = 'Datos incompletos. Se requieren: userId, eventType y payload';
      logger.warn('Solicitud inválida', { requestId, error, body: req.body });
      return res.status(400).json({ 
        success: false, 
        error,
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    // Verificar si el usuario está conectado
    const isUserConnected = connectedUsers.has(userId);
    const socketId = connectedUsers.get(userId);
    
    if (!isUserConnected || !socketId) {
      logger.warn('Usuario no conectado', { 
        requestId, 
        userId, 
        connectedUsers: Array.from(connectedUsers.keys()) 
      });
      return res.status(404).json({
        success: false,
        error: 'Usuario no conectado',
        userId,
        requestId,
        timestamp: new Date().toISOString(),
        connectedUsersCount: connectedUsers.size
      });
    }

    // Emitir el evento al usuario
    io.to(userId).emit(eventType, payload);
    
    logger.info('Evento emitido exitosamente', { 
      requestId, 
      userId, 
      eventType,
      socketId,
      payloadSize: JSON.stringify(payload)?.length || 0
    });

    res.json({ 
      success: true, 
      message: 'Evento emitido correctamente',
      requestId,
      timestamp: new Date().toISOString(),
      socketId
    });
  } catch (error) {
    logger.error('Error al procesar la solicitud de emisión', { 
      requestId,
      error: error.stack || error.message,
      body: req.body,
      headers: JSON.stringify(req.headers)
    });
    
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Ruta de verificación de salud
app.get('/health', (req, res) => {
  const healthCheckId = `health-${Date.now()}`;
  
  try {
    // Obtener información del sistema
    const os = require('os');
    const processMemory = process.memoryUsage();
    
    const healthData = {
      status: 'ok',
      server: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptime: process.uptime(),
        memory: {
          rss: `${(processMemory.rss / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(processMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
          heapUsed: `${(processMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
          external: processMemory.external ? `${(processMemory.external / 1024 / 1024).toFixed(2)} MB` : 'N/A'
        }
      },
      system: {
        hostname: os.hostname(),
        type: os.type(),
        release: os.release(),
        cpus: os.cpus().length,
        totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        loadAvg: os.loadavg()
      },
      connections: {
        active: io.engine.clientsCount || 0,
        connectedUsers: connectedUsers.size,
        maxSockets: http.globalAgent.maxSockets
      },
      timestamp: new Date().toISOString(),
      requestId: healthCheckId
    };
    
    logger.info('Verificación de salud completada', { 
      healthCheckId,
      status: 'success',
      activeConnections: healthData.connections.active,
      connectedUsers: healthData.connections.connectedUsers
    });
    
    res.json(healthData);
  } catch (error) {
    logger.error('Error en verificación de salud', { 
      healthCheckId,
      error: error.stack || error.message
    });
    
    res.status(500).json({
      status: 'error',
      error: 'Error al verificar el estado del servidor',
      message: error.message,
      timestamp: new Date().toISOString(),
      requestId: healthCheckId
    });
  }
});

// Manejador de errores no capturados
process.on('uncaughtException', (error) => {
  logger.error('Excepción no capturada', error);
  // Cerrar el servidor de manera controlada
  try {
    server.close(() => {
      logger.info('Servidor cerrado debido a una excepción no capturada');
      process.exit(1);
    });
  } catch (err) {
    logger.error('Error al cerrar el servidor', err);
    process.exit(1);
  }
});

// Iniciar servidor
try {
  server.listen(PORT, () => {
    logger.info(`Servidor WebSocket escuchando en el puerto ${PORT}`);
    logger.info(`Entorno: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Número de CPUs: ${require('os').cpus().length}`);
  });
} catch (error) {
  logger.error('Error al iniciar el servidor', error);
  process.exit(1);
}
