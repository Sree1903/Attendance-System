/**
 * Geofencing and Location Verification Utilities
 * Implements Haversine formula for accurate distance calculation
 */

import {
  EARTH_RADIUS_METERS,
  DEFAULT_GEOFENCE_RADIUS,
  UNREALISTIC_ACCURACY_THRESHOLD,
  UNREALISTIC_SPEED_THRESHOLD,
  SPOOFING_SCORE_ACCURACY,
  SPOOFING_SCORE_SPEED,
  SPOOFING_SCORE_MOCK,
  SPOOFING_FLAG_THRESHOLD,
  SPOOFING_BLOCK_THRESHOLD,
} from '../config/constants.js';

/*
 * Maximum GPS accuracy uncertainty we will accept when
 * a location is being used for geofence verification.
 *
 * This is a product-level threshold, not a guarantee of
 * physical GPS precision.
 */
const MAX_GEOFENCE_ACCURACY = 50;

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
export const calculateDistance = (
  lat1,
  lon1,
  lat2,
  lon2
) => {
  const R = EARTH_RADIUS_METERS;

  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;

  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) *
      Math.cos(φ2) *
      Math.sin(Δλ / 2) *
      Math.sin(Δλ / 2);

  const c =
    2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
};

/**
 * Verify if student location is within geofence
 *
 * The verification now considers:
 * 1. Distance from the session location
 * 2. Reported GPS accuracy
 *
 * @param {Object} sessionLocation
 * @param {Object} studentLocation
 * @returns {Object} Verification result
 */
export const verifyGeofence = (
  sessionLocation,
  studentLocation
) => {
  // ----------------------------------------------------
  // 1. Check whether the session has a geofence
  // ----------------------------------------------------

  if (
    !sessionLocation ||
    typeof sessionLocation.latitude !== 'number' ||
    typeof sessionLocation.longitude !== 'number'
  ) {
    return {
      verified: true,
      reason:
        'Geofencing not configured for this session',
      distance: null,
      radius: null,
      accuracy: null,
    };
  }

  // ----------------------------------------------------
  // 2. Check whether the student's location exists
  // ----------------------------------------------------

  if (
    !studentLocation ||
    typeof studentLocation.latitude !== 'number' ||
    typeof studentLocation.longitude !== 'number'
  ) {
    return {
      verified: false,
      reason: 'Student location not provided',
      distance: null,
      radius:
        sessionLocation.radius ||
        DEFAULT_GEOFENCE_RADIUS,
      accuracy: null,
    };
  }

  // ----------------------------------------------------
  // 3. Calculate distance
  // ----------------------------------------------------

  const distance = calculateDistance(
    sessionLocation.latitude,
    sessionLocation.longitude,
    studentLocation.latitude,
    studentLocation.longitude
  );

  const radius =
    sessionLocation.radius ||
    DEFAULT_GEOFENCE_RADIUS;

  // ----------------------------------------------------
  // 4. Read GPS accuracy
  // ----------------------------------------------------

  const rawAccuracy = Number(
    studentLocation.accuracy
  );

  const hasAccuracy =
    Number.isFinite(rawAccuracy) &&
    rawAccuracy >= 0;

  const accuracy = hasAccuracy
    ? rawAccuracy
    : null;

  // ----------------------------------------------------
  // 5. Reject very inaccurate location readings
  // ----------------------------------------------------
  //
  // Example:
  //
  // Geofence = 100m
  // Student GPS accuracy = ±150m
  //
  // We cannot confidently use that reading for a
  // 100m geofence.
  //
  // We therefore ask the student to use Precise Location.
  // ----------------------------------------------------

  if (
    accuracy !== null &&
    accuracy > MAX_GEOFENCE_ACCURACY
  ) {
    return {
      verified: false,
      distance: Math.round(distance),
      radius,
      accuracy: Math.round(accuracy),
      reason:
        `GPS accuracy is too low (±${Math.round(
          accuracy
        )}m). Enable Precise Location and try again.`,
    };
  }

  // ----------------------------------------------------
  // 6. Verify the actual geofence distance
  // ----------------------------------------------------

  const verified = distance <= radius;

  // ----------------------------------------------------
  // 7. Return complete verification result
  // ----------------------------------------------------

  return {
    verified,
    distance: Math.round(distance),
    radius,
    accuracy:
      accuracy !== null
        ? Math.round(accuracy)
        : null,

    reason: verified
      ? 'Location verified successfully'
      : `Outside geofence boundary (${Math.round(
          distance
        )}m away, allowed: ${radius}m)`,
  };
};

/**
 * Get location accuracy status
 * @param {number} accuracy - GPS accuracy in meters
 * @returns {string} Accuracy status
 */
export const getLocationAccuracy = (
  accuracy
) => {
  if (
    accuracy === null ||
    accuracy === undefined ||
    !Number.isFinite(Number(accuracy))
  ) {
    return 'UNKNOWN';
  }

  const numericAccuracy = Number(accuracy);

  if (numericAccuracy <= 10) {
    return 'HIGH';
  }

  if (numericAccuracy <= 50) {
    return 'MEDIUM';
  }

  return 'LOW';
};

/**
 * Validate location coordinates
 * @param {number} latitude - Latitude value
 * @param {number} longitude - Longitude value
 * @returns {boolean}
 */
export const validateCoordinates = (
  latitude,
  longitude
) => {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

/**
 * Format location for display
 * @param {number} latitude - Latitude value
 * @param {number} longitude - Longitude value
 * @returns {string}
 */
export const formatLocation = (
  latitude,
  longitude
) => {
  if (
    !validateCoordinates(
      latitude,
      longitude
    )
  ) {
    return 'Invalid coordinates';
  }

  return `${latitude.toFixed(
    6
  )}, ${longitude.toFixed(6)}`;
};

/**
 * Check if location services are likely spoofed
 * @param {Object} locationData
 * @returns {Object}
 */
export const detectLocationSpoofing = (
  locationData
) => {
  const warnings = [];
  let suspiciousScore = 0;

  // Check for unrealistic accuracy
  if (
    locationData.accuracy &&
    locationData.accuracy <
      UNREALISTIC_ACCURACY_THRESHOLD
  ) {
    warnings.push(
      'Unrealistically high accuracy'
    );

    suspiciousScore +=
      SPOOFING_SCORE_ACCURACY;
  }

  // Check for impossible speed
  if (
    locationData.speed &&
    locationData.speed >
      UNREALISTIC_SPEED_THRESHOLD
  ) {
    warnings.push(
      'Unrealistic speed detected'
    );

    suspiciousScore +=
      SPOOFING_SCORE_SPEED;
  }

  // Check for mock location flag
  if (locationData.isMock === true) {
    warnings.push(
      'Mock location detected'
    );

    suspiciousScore +=
      SPOOFING_SCORE_MOCK;
  }

  return {
    isSuspicious:
      suspiciousScore >=
      SPOOFING_BLOCK_THRESHOLD,

    suspiciousScore,

    warnings,

    recommendation:
      suspiciousScore >=
      SPOOFING_BLOCK_THRESHOLD
        ? 'BLOCK'
        : suspiciousScore >=
          SPOOFING_FLAG_THRESHOLD
        ? 'FLAG'
        : 'ALLOW',
  };
};

/**
 * Get campus presets for common locations
 * @returns {Object}
 */
export const getCampusPresets = () => {
  return {
    mainBuilding: {
      name: 'Main Building',
      latitude: 0,
      longitude: 0,
      radius: 100,
    },

    library: {
      name: 'Library',
      latitude: 0,
      longitude: 0,
      radius: 50,
    },

    lab: {
      name: 'Computer Lab',
      latitude: 0,
      longitude: 0,
      radius: 75,
    },

    auditorium: {
      name: 'Auditorium',
      latitude: 0,
      longitude: 0,
      radius: 150,
    },
  };
};
