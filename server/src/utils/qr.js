import crypto from 'crypto';

const QR_ROTATION_INTERVAL = parseInt(process.env.QR_ROTATION_INTERVAL) || 60000; // 60 seconds

if (!process.env.QR_SECRET && process.env.NODE_ENV === 'production') {
  console.error('❌ FATAL: QR_SECRET env var is not set. QR tokens are insecure in production!');
  process.exit(1);
}
const QR_SECRET = process.env.QR_SECRET || 'default-qr-secret-change-me';
const QR_VALIDITY_WINDOW = 5; // Allow 5 intervals = 100 seconds (1 min 40 sec)

/**
 * Generate QR token with HMAC signature
 * @param {string} sessionId - Session ID
 * @returns {string} Signed QR token
 */
export const generateQRToken = (sessionId) => {
  // Round timestamp to interval (20 sec blocks)
  const now = Date.now();
  const roundedTime = Math.floor(now / QR_ROTATION_INTERVAL) * QR_ROTATION_INTERVAL;
  
  const payload = {
    sid: sessionId,
    t: roundedTime,
  };
  
  // Create HMAC signature
  const payloadString = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', QR_SECRET)
    .update(payloadString)
    .digest('hex');
  
  // Encode payload and append signature
  const encodedPayload = Buffer.from(payloadString).toString('base64');
  const token = `${encodedPayload}.${signature}`;
  
  return token;
};

/**
 * Verify QR token signature and expiration
 * @param {string} token - QR token to verify
 * @returns {object|null} Decoded payload or null if invalid
 */
export const verifyQRToken = (token) => {
  try {
    const [encodedPayload, signature] = token.split('.');
    
    if (!encodedPayload || !signature) {
      console.log('❌ QR Token: Missing payload or signature');
      return null;
    }
    
    // Decode payload
    const payloadString = Buffer.from(encodedPayload, 'base64').toString('utf-8');
    const payload = JSON.parse(payloadString);
    
    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', QR_SECRET)
      .update(payloadString)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      console.log('❌ QR Token: Invalid signature');
      return null;
    }
    
    // Check expiration - allow multiple intervals for face verification time
    const now = Date.now();
    const currentInterval = Math.floor(now / QR_ROTATION_INTERVAL) * QR_ROTATION_INTERVAL;
    const tokenAge = (currentInterval - payload.t) / QR_ROTATION_INTERVAL;
    
    // Allow tokens from last 5 intervals (100 seconds)
    if (tokenAge < 0 || tokenAge >= QR_VALIDITY_WINDOW) {
      console.log(`❌ QR Token: Expired (age: ${tokenAge} intervals, max: ${QR_VALIDITY_WINDOW})`);
      return null;
    }
    
    console.log(`✅ QR Token: Valid (age: ${tokenAge} intervals)`);
    return payload;
  } catch (error) {
    console.log('❌ QR Token: Parse error:', error.message);
    return null;
  }
};

/**
 * Get QR rotation interval in milliseconds
 */
export const getQRRotationInterval = () => QR_ROTATION_INTERVAL;
