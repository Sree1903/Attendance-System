/**
 * Advanced Security Middleware
 * FANG-Level: CSP, Encryption, HMAC, Request Signing
 */

import crypto from 'crypto';
import helmet from 'helmet';

/**
 * Content Security Policy configuration
 */
export function contentSecurityPolicy() {
  return helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      frameSrc: ["'self'", "https://zoom.us"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  });
}

/**
 * Security headers middleware
 */
export function securityHeaders() {
  return (req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions policy
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    
    // HSTS (HTTP Strict Transport Security)
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    next();
  };
}

/**
 * Encryption utilities
 */
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
const ALGORITHM = 'aes-256-gcm';

export function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

export function decrypt(encryptedData) {
  const { encrypted, iv, authTag } = encryptedData;
  
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(iv, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Hash sensitive data (one-way)
 */
export function hashData(data, salt = null) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(data, actualSalt, 10000, 64, 'sha512').toString('hex');
  
  return {
    hash,
    salt: actualSalt
  };
}

/**
 * Verify hashed data
 */
export function verifyHash(data, hash, salt) {
  const newHash = crypto.pbkdf2Sync(data, salt, 10000, 64, 'sha512').toString('hex');
  return newHash === hash;
}

/**
 * HMAC request signing
 */
export function signRequest(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

/**
 * Verify HMAC signature
 */
export function verifySignature(payload, signature, secret) {
  const expectedSignature = signRequest(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Request signing middleware
 */
export function requestSigningMiddleware(req, res, next) {
  // Skip for GET requests
  if (req.method === 'GET') {
    return next();
  }

  const signature = req.headers['x-signature'];
  const timestamp = req.headers['x-timestamp'];

  if (!signature || !timestamp) {
    return res.status(401).json({
      success: false,
      message: 'Missing request signature'
    });
  }

  // Check timestamp (prevent replay attacks)
  const requestTime = parseInt(timestamp);
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes

  if (Math.abs(now - requestTime) > maxAge) {
    return res.status(401).json({
      success: false,
      message: 'Request timestamp expired'
    });
  }

  // Verify signature
  const payload = {
    ...req.body,
    timestamp: requestTime
  };

  const secret = process.env.REQUEST_SIGNING_SECRET || 'default-secret';
  
  try {
    if (!verifySignature(payload, signature, secret)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid request signature'
      });
    }
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Signature verification failed'
    });
  }

  next();
}

/**
 * API Key authentication
 */
const apiKeys = new Map();

export function registerAPIKey(key, metadata) {
  apiKeys.set(key, {
    ...metadata,
    createdAt: Date.now(),
    lastUsed: null,
    requestCount: 0
  });
}

export function apiKeyMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: 'API key required'
    });
  }

  const keyData = apiKeys.get(apiKey);

  if (!keyData) {
    return res.status(401).json({
      success: false,
      message: 'Invalid API key'
    });
  }

  // Update usage stats
  keyData.lastUsed = Date.now();
  keyData.requestCount++;

  // Attach key metadata to request
  req.apiKey = keyData;

  next();
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input) {
  // Handle strings
  if (typeof input === 'string') {
    return input
      .replace(/[<>]/g, '') // Remove < and >
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  }

  // IMPORTANT: Preserve arrays as arrays
  if (Array.isArray(input)) {
    return input.map(item => sanitizeInput(item));
  }

  // Handle objects
  if (typeof input === 'object' && input !== null) {
    const sanitized = {};

    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }

    return sanitized;
  }

  return input;
}

/**
 * Input sanitization middleware
 */
export function sanitizeMiddleware(req, res, next) {
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }

  if (req.query) {
    req.query = sanitizeInput(req.query);
  }

  if (req.params) {
    req.params = sanitizeInput(req.params);
  }

  next();
}

/**
 * SQL Injection prevention (for raw queries)
 */
export function escapeSQLInput(input) {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/'/g, "''")
    .replace(/;/g, '')
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '');
}

/**
 * NoSQL Injection prevention
 */
export function sanitizeMongoQuery(query) {
  if (typeof query !== 'object' || query === null) {
    return query;
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(query)) {
    // Remove $ operators from user input
    if (key.startsWith('$')) {
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeMongoQuery(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Secure random token generation
 */
export function generateSecureToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate API key
 */
export function generateAPIKey() {
  const prefix = 'pk_';
  const random = crypto.randomBytes(32).toString('base64url');
  return prefix + random;
}

/**
 * Password strength validator
 */
export function validatePasswordStrength(password) {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const score = [
    password.length >= minLength,
    hasUpperCase,
    hasLowerCase,
    hasNumbers,
    hasSpecialChar
  ].filter(Boolean).length;

  return {
    isValid: score >= 4,
    score,
    feedback: {
      length: password.length >= minLength,
      uppercase: hasUpperCase,
      lowercase: hasLowerCase,
      numbers: hasNumbers,
      specialChar: hasSpecialChar
    }
  };
}

/**
 * Detect suspicious patterns in requests
 */
export function detectSuspiciousPatterns(req) {
  const suspiciousPatterns = [
    /(\bor\b|\band\b)\s*=\s*=/, // SQL injection with equals
    /\$where\s*:|{.*\$ne.*}|{.*\$gt.*}|{.*\$lt.*}/, // NoSQL injection operators
    /<script[^>]*>|javascript:\s*|onerror\s*=/i, // XSS
    /\.\.[\/\\]|\.\.%2[fF]|\.\.%5[cC]/, // Path traversal
    /eval\s*\(|exec\s*\(|system\s*\(/i // Code injection
  ];

  const checkString = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params
  });

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(checkString)) {
      return {
        suspicious: true,
        pattern: pattern.toString(),
        timestamp: Date.now()
      };
    }
  }

  return { suspicious: false };
}

/**
 * Suspicious pattern detection middleware
 */
export function suspiciousPatternMiddleware(req, res, next) {
  const detection = detectSuspiciousPatterns(req);

  if (detection.suspicious) {
    console.warn(`⚠️ Suspicious pattern detected:`, {
      ip: req.ip,
      path: req.path,
      pattern: detection.pattern
    });

    return res.status(400).json({
      success: false,
      message: 'Suspicious request pattern detected'
    });
  }

  next();
}

export default {
  contentSecurityPolicy,
  securityHeaders,
  encrypt,
  decrypt,
  hashData,
  verifyHash,
  signRequest,
  verifySignature,
  requestSigningMiddleware,
  apiKeyMiddleware,
  registerAPIKey,
  sanitizeInput,
  sanitizeMiddleware,
  escapeSQLInput,
  sanitizeMongoQuery,
  generateSecureToken,
  generateAPIKey,
  validatePasswordStrength,
  detectSuspiciousPatterns,
  suspiciousPatternMiddleware
};
