const authService = require('../services/auth');
const prisma = require('../lib/prisma');

async function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      (socket.handshake.headers?.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.slice(7)
        : null);

    if (!token) {
      return next(new Error('Authentication required: Missing JWT token in socket handshake'));
    }

    let payload;
    try {
      payload = authService.verifyAccessToken(token);
    } catch (err) {
      return next(new Error('Authentication failed: Invalid or expired access token (' + err.message + ')'));
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { driverProfile: { include: { vehicle: true } } }
    });

    if (!user) {
      return next(new Error('Authentication failed: User account not found'));
    }

    if (user.status !== 'ACTIVE') {
      return next(new Error(`Account access denied: Account is ${user.status.toLowerCase()}`));
    }

    if (user.role === 'DRIVER' && user.driverProfile) {
      if (user.driverProfile.approvalStatus !== 'APPROVED') {
        return next(new Error(`Driver profile not approved: Current status is ${user.driverProfile.approvalStatus}`));
      }
    }

    socket.user = user;
    socket.userId = user.id;
    socket.userRole = user.role;
    socket.driverId = user.driverProfile ? user.driverProfile.id : null;
    socket.driver = user.driverProfile || null;

    next();
  } catch (err) {
    next(new Error('Socket connection rejected: ' + err.message));
  }
}

module.exports = socketAuthMiddleware;
