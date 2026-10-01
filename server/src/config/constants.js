// ============================================
// ATTENDANCE THRESHOLDS (University Policy)
// ============================================
export const ATTENDANCE_THRESHOLD_GOOD = 75;     // >= 75% is good standing
export const ATTENDANCE_THRESHOLD_WARNING = 60;  // 60-74% is warning zone
// Below 60% is considered "At Risk"

// ============================================
// PAGINATION & DISPLAY LIMITS
// ============================================
export const DEFAULT_PAGE_SIZE = 10;             // users per page in admin dashboard
export const AUDIT_LOG_PAGE_SIZE = 50;           // audit logs per page
export const TOP_USERS_LIMIT = 10;               // top users in activity aggregation

// ============================================
// ANALYTICS LIMITS
// ============================================
export const DAILY_TREND_DAYS = 30;              // days of trend data to compute
export const AT_RISK_DISPLAY_LIMIT = 20;         // max at-risk students shown
export const RECENT_SESSIONS_LIMIT = 10;         // recent sessions in student analytics
export const MONTHLY_TREND_MONTHS = 6;           // months of monthly trend data
export const RECENT_ATTENDANCE_LIMIT = 5;        // recent attendance records on dashboard

// ============================================
// GEOFENCING CONFIGURATION
// ============================================
export const DEFAULT_GEOFENCE_RADIUS = 100;      // default radius in meters
export const EARTH_RADIUS_METERS = 6371e3;       // Earth's radius for Haversine formula

// Smart geofencing rules based on session type
export const GEOFENCE_RULES = {
  CLASSROOM: {
    radius: 50, // meters
    strictMode: false,
    requireLiveness: false,
  },
  EXAM: {
    radius: 30, // tighter for exams
    strictMode: true,
    requireLiveness: true,
  },
  OUTDOOR: {
    radius: 100, // larger for outdoor sessions
    strictMode: false,
    requireLiveness: false,
  },
  LAB: {
    radius: 40,
    strictMode: true,
    requireLiveness: false,
  },
};

// Peer validation settings
export const PEER_VALIDATION = {
  ENABLED: true,
  MIN_STUDENTS_FOR_VALIDATION: 5, // Need at least 5 students to validate
  OUTLIER_DISTANCE_THRESHOLD: 500, // meters - flag if 500m+ from peer cluster
  OUTLIER_RISK_SCORE: 25,
};

// Impossible travel detection
export const TRAVEL_DETECTION = {
  ENABLED: true,
  MAX_WALKING_SPEED: 1.4, // meters per second (5 km/h)
  MAX_RUNNING_SPEED: 3.0, // meters per second (10.8 km/h)
  MAX_VEHICLE_SPEED: 20.0, // meters per second (72 km/h)
  IMPOSSIBLE_TRAVEL_RISK_SCORE: 30,
  TIME_WINDOW_MINUTES: 30, // Check travel within last 30 minutes
};

// ============================================
// DEVICE FINGERPRINTING & SECURITY
// ============================================
export const SHARED_DEVICE_THRESHOLD = 3;        // fingerprint used by >N users = suspicious
export const DEVICE_RISK_SHARED = 30;            // risk score for shared device
export const DEVICE_RISK_PROXY_VPN = 40;         // risk score for proxy/VPN
export const DEVICE_RISK_TOR = 50;               // risk score for Tor
export const DEVICE_RISK_SUSPICIOUS_UA = 20;     // risk score for suspicious user agent
export const DEVICE_RISK_THRESHOLD = 50;         // riskScore > N = suspicious device
export const MIN_USER_AGENT_LENGTH = 20;         // minimum user agent length

// ============================================
// LOCATION SPOOFING DETECTION
// ============================================
export const UNREALISTIC_ACCURACY_THRESHOLD = 1; // GPS accuracy < 1m = suspicious
export const UNREALISTIC_SPEED_THRESHOLD = 50;   // speed > 50 m/s (180 km/h) = suspicious
export const SPOOFING_SCORE_ACCURACY = 2;        // suspicion score for unrealistic accuracy
export const SPOOFING_SCORE_SPEED = 3;           // suspicion score for unrealistic speed
export const SPOOFING_SCORE_MOCK = 5;            // suspicion score for mock location
export const SPOOFING_FLAG_THRESHOLD = 3;        // score >= N = FLAG recommendation
export const SPOOFING_BLOCK_THRESHOLD = 5;       // score >= N = BLOCK recommendation

// ============================================
// TOKEN & SESSION CONFIGURATION
// ============================================
export const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
export const QR_TOKEN_ROTATION_INTERVAL = 60000; // QR code rotation interval in ms (20 seconds)

// ============================================
// RATE LIMITING
// ============================================
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_REQUESTS = 500;         // max requests per window

// ============================================
// SESSION CONFIGURATION
// ============================================
export const DEFAULT_SESSION_DURATION = 60;      // default session duration in minutes
export const SESSION_STATUS_ENUM = ['SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'];
export const ATTENDANCE_SOURCE_ENUM = ['QR', 'FACE', 'ZOOM', 'GOOGLE_MEET', 'TEAMS', 'WEBRTC', 'AUTO'];

// ============================================
// USER ROLES
// ============================================
export const USER_ROLES = {
  ADMIN: 'ADMIN',
  FACULTY: 'FACULTY',
  STUDENT: 'STUDENT'
};

// ============================================
// ATTENDANCE STATUS
// ============================================
export const ATTENDANCE_STATUS = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  LATE: 'LATE'
};

// ============================================
// ALERT & RISK SCORING
// ============================================
export const RISK_SCORE_THRESHOLDS = {
  LOW: 30,                    // 0-30: Low risk
  MEDIUM: 50,                 // 31-50: Medium risk
  HIGH: 70,                   // 51-70: High risk
  CRITICAL: 100,              // 71-100: Critical risk
};

export const RISK_FACTOR_SCORES = {
  PROXY_DETECTED: 25,
  VPN_DETECTED: 20,
  TOR_DETECTED: 40,
  RESIDENTIAL_PROXY: 35,
  DATACENTER_IP: 30,
  IMPOSSIBLE_TRAVEL: 45,
  SUSPICIOUS_DEVICE: 25,
  LOCATION_SPOOFING: 35,
  SHARED_DEVICE: 20,
  UNUSUAL_TIME: 15,
};

export const ALERT_CREATION_THRESHOLD = 70;  // Create alert if risk score >= 70
export const RESIDENTIAL_PROXY_DETECTION_THRESHOLD = 10; // 10+ students from same IP in 24h
export const IP_SWITCH_THRESHOLD = 5;        // 5+ IP switches in 24h = suspicious

// ============================================
// CURSOR PAGINATION
// ============================================
export const CURSOR_PAGE_SIZE = 20;           // default cursor pagination size
export const MAX_CURSOR_PAGE_SIZE = 100;      // maximum allowed page size
