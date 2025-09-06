const { Server } = require('socket.io');
const logger = require('../utils/logger');

let io;

const initializeWebSocket = (server) => {
  io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  io.on('connection', (socket) => {
    logger.info('Client connected:', { socketId: socket.id });

    socket.on('join-payment', (reference) => {
      socket.join(`payment-${reference}`);
      logger.info('Joined payment room:', { reference });
    });

    socket.on('disconnect', () => {
      logger.info('Client disconnected:', { socketId: socket.id });
    });
  });

  return io;
};

const notifyPaymentUpdate = (reference, status, data = {}) => {
  if (io) {
    io.to(`payment-${reference}`).emit('payment-update', {
      reference,
      status,
      timestamp: new Date().toISOString(),
      ...data
    });
  }
};

module.exports = { initializeWebSocket, notifyPaymentUpdate };
