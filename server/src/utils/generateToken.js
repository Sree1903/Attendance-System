import jwt from 'jsonwebtoken';

if (!process.env.JWT_ACCESS_SECRET && !process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('❌ FATAL: JWT_ACCESS_SECRET (or JWT_SECRET) env var is not set. Auth tokens are insecure in production!');
  process.exit(1);
}

// Fallback to JWT_SECRET if specific secrets not provided
const getAccessSecret = () => process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'fallback_secret_change_in_production';
const getRefreshSecret = () => process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'fallback_secret_change_in_production';

/**
 * Generate JWT access token
 */
export const generateAccessToken = (userId, role) => {
  return jwt.sign(
    { userId, role },
    getAccessSecret(),
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '7d' }
  );
};

/**
 * Generate JWT refresh token
 */
export const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId },
    getRefreshSecret(),
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
};

/**
 * Verify access token
 */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, getAccessSecret());
  } catch (error) {
    return null;
  }
};

/**
 * Verify refresh token
 */
export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, getRefreshSecret());
  } catch (error) {
    return null;
  }
};
