const socketAuthMiddleware = require('./authMiddleware');
const registerTripHandlers = require('./tripHandlers');
const registerChatHandlers = require('./chatHandlers');
const prisma = require('../lib/prisma');
const { joinUserRooms } = require('./rooms');
const { OPS_ROOM } = require('./emitters');

function setupSockets(io, operationalState = {}) {
  let connectedClients = 0;

  // Strict JWT & DB status check on connection handshake
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    connectedClients++;
    console.log(`[Socket.IO] Client connected (${socket.id}, User: ${socket.userId}, Role: ${socket.userRole}). Total clients: ${connectedClients}`);
    // Rooms come from the verified login and the database, never from the client.
    joinUserRooms(socket, prisma);
    io.to(OPS_ROOM).emit('clients:count', connectedClients);

    // Register Modular Handlers
    registerTripHandlers(io, socket);
    registerChatHandlers(io, socket, operationalState);

    socket.on('disconnect', () => {
      connectedClients--;
      console.log(`[Socket.IO] Client disconnected (${socket.id}). Remaining: ${connectedClients}`);
      io.to(OPS_ROOM).emit('clients:count', connectedClients);
    });
  });

  return io;
}

module.exports = setupSockets;
