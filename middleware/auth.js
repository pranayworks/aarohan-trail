// ============================================================================
// AAROHAN AUTHORIZATION & ROLE MIDDLEWARE • LILONGWE, MALAWI
// ============================================================================
// Enforces:
//   1. Deny by default: requireAuth on all protected endpoints
//   2. Strict HS256 JWT signature and expiration verification
//   3. Database-level user status check (UserStatus.ACTIVE)
//   4. Role-based access control (RIDER, DRIVER, ADMIN, SUPPORT, FINANCE)
//   5. Driver approval status verification (DriverApproval.APPROVED)
//   6. Zod schema validation for request payloads and queries
// ============================================================================

const { verifyAccessToken } = require('../services/auth');
const prisma = require('../lib/prisma');

/**
 * requireAuth: Authenticates Bearer JWT and verifies user status in database
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required: Missing or malformed Authorization header' });
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Authentication required: Token missing' });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Authentication expired: Access token has expired. Please refresh your session.', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Authentication invalid: Token signature or algorithm verification failed', code: 'TOKEN_INVALID' });
    }

    // Verify User in database to check status (ACTIVE vs SUSPENDED / BANNED)
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { driverProfile: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Authentication invalid: User account does not exist' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: `Account access denied: Account is ${user.status.toLowerCase()}`, code: 'ACCOUNT_INACTIVE' });
    }

    // Bind authoritative user context to request
    req.user = {
      id: user.id,
      phone: user.phone,
      role: user.role,
      status: user.status,
      driverId: user.driverProfile ? user.driverProfile.id : null,
      driverProfile: user.driverProfile || null
    };

    next();
  } catch (err) {
    return res.status(500).json({ error: 'Internal authentication error: ' + err.message });
  }
}

/**
 * requireRole: Restricts endpoint to specific roles
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: Access requires one of [${allowedRoles.join(', ')}]. Current role: ${req.user.role}`,
        code: 'FORBIDDEN_ROLE'
      });
    }

    next();
  };
}

/**
 * requireDriverApproval: Ensures driver is APPROVED in PostgreSQL
 */
async function requireDriverApproval(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'DRIVER') {
    return res.status(403).json({ error: 'Forbidden: Driver account required' });
  }

  const driver = await prisma.driver.findFirst({
    where: { userId: req.user.id }
  });

  if (!driver) {
    return res.status(403).json({ error: 'Forbidden: Driver profile not found' });
  }

  if (driver.approvalStatus !== 'APPROVED') {
    return res.status(403).json({
      error: `Forbidden: Driver profile is ${driver.approvalStatus.toLowerCase()}. Pending admin review.`,
      code: 'DRIVER_NOT_APPROVED'
    });
  }

  req.driver = driver;
  next();
}

/**
 * validateBody: Zod validation middleware for request body
 */
function validateBody(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
        });
      }
      req.body = parsed.data;
      next();
    } catch (err) {
      return res.status(400).json({ error: 'Malformed request payload: ' + err.message });
    }
  };
}

/**
 * validateQuery: Zod validation middleware for request query
 */
function validateQuery(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Query parameter validation failed',
          details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
        });
      }
      req.query = parsed.data;
      next();
    } catch (err) {
      return res.status(400).json({ error: 'Malformed query parameters: ' + err.message });
    }
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requireDriverApproval,
  validateBody,
  validateQuery
};
