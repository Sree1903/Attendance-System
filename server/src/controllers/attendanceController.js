import mongoose from 'mongoose';
import Attendance from '../models/Attendance.js';
import Session from '../models/Session.js';
import Class from '../models/Class.js';
import User from '../models/User.js';
import Alert from '../models/Alert.js';
import VerificationQueue from '../models/VerificationQueue.js';
import { verifyQRToken, generateQRToken } from '../utils/qr.js';
import { verifyGeofence, validateCoordinates, detectLocationSpoofing } from '../utils/geofencing.js';
import { generateDeviceFingerprint, parseUserAgent, detectSuspiciousDevice } from '../utils/deviceFingerprint.js';
import { detectResidentialProxy, calculateIPReputation } from '../utils/advancedProxyDetection.js';
import { validatePeerLocation, detectImpossibleTravel } from '../utils/smartValidation.js';
import { safeProxyCheck } from '../utils/circuitBreaker.js';
import { createAuditLog } from '../middleware/auditLogger.js';
import { ALERT_CREATION_THRESHOLD, RISK_FACTOR_SCORES } from '../config/constants.js';
import { getIO, emitAttendanceMarked } from '../utils/ioManager.js';

/**
 * Check for nearby active sessions
 */
export const checkNearbySession = async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;

    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates provided',
      });
    }

    // Find all live sessions that use location-based verification and don't require QR.
    // We query by verificationRequirements (what faculty configures) — NOT by
    // location.geofencingEnabled, which is often never set by the faculty UI.
    const liveSessions = await Session.find({
      status: 'LIVE',
      'verificationRequirements.locationVerification': true,
      'verificationRequirements.qrCode': { $ne: true }, // auto-attendance = no QR
    }).populate('class', 'name code students');

    if (liveSessions.length === 0) {
      return res.json({
        success: true,
        data: { session: null, message: 'No active sessions nearby' },
      });
    }

    let nearestSession = null;
    let minDistance = Infinity;

    for (const session of liveSessions) {
      if (!session.class || !session.class.students) continue;

      // Enrollment check
      const isEnrolled = session.class.students.some(
        (id) => id.toString() === req.user._id.toString()
      );
      if (!isEnrolled) continue;

      // Distance check — only if session has coordinates set by faculty
    let distance = null;
let withinRange = true;
let locationVerificationReason =
  'Location not configured for this session';

if (session.location?.latitude && session.location?.longitude) {
  const verification = verifyGeofence(session.location, {
    latitude,
    longitude,
    accuracy,
  });

  distance = verification.distance;
  withinRange = verification.verified;
  locationVerificationReason = verification.reason;
}
      const effectiveDistance = distance ?? 0;
      if (effectiveDistance < minDistance) {
        minDistance = effectiveDistance;
       nearestSession = {
  ...session.toObject(),
  distance,
  withinRange,
  locationVerificationReason,
};
      }
    }

    if (!nearestSession) {
      return res.json({
        success: true,
        data: {
          session: null,
          message: 'No sessions found for your enrolled classes',
        },
      });
    }

    // Check if already marked
    const existingAttendance = await Attendance.findOne({
      session: nearestSession._id,
      student: req.user._id,
    });

    res.json({
      success: true,
    data: {
  session: nearestSession,
  distance: nearestSession.distance,
  withinRange: nearestSession.withinRange,
  locationAccuracy: accuracy ?? null,
  locationVerificationReason:
    nearestSession.locationVerificationReason || null,
  alreadyMarked: !!existingAttendance,
},
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Mark attendance by scanning QR
 */
export const markAttendance = async (req, res) => {
  try {
    const { qrToken, location, autoMarked, deviceInfo, faceVerificationPassed } = req.body;
    
    // CRITICAL: Handle different verification scenarios
    let payload = null;
    let session = null;
    
    if (qrToken) {
      // QR-based attendance (most common)
      payload = verifyQRToken(qrToken);
      
      if (!payload) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired QR code',
        });
      }
      
      // Get session (optimized with lean query)
      session = await Session.findById(payload.sid).populate('class').lean();
    } else if (autoMarked && location) {
      // Auto-attendance (location-only) — find the session by GPS
      let nearbySessionData = null;
      try {
        nearbySessionData = await findNearbySession(req.user._id, location);
      } catch (err) {
        console.error('Error finding nearby session:', err);
        return res.status(500).json({ success: false, message: 'Error checking nearby sessions' });
      }

      if (!nearbySessionData) {
        return res.status(404).json({
          success: false,
          message: 'No active session found in your location',
        });
      }

      // Block auto-attendance when QR is required to prevent bypassing it
      if (nearbySessionData.verificationRequirements?.qrCode) {
        return res.status(403).json({
          success: false,
          message: 'This session requires QR code scanning. Auto-attendance is not available.',
        });
      }

      session = nearbySessionData;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Either QR token or location (for auto-attendance) is required',
      });
    }
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    if (session.status !== 'LIVE') {
      return res.status(400).json({
        success: false,
        message: 'Session is not live',
      });
    }
    
    // Check if student is enrolled (optimized query)
    const classData = await Class.findById(session.class._id).select('students').lean();
    const isEnrolled = classData.students.some(
      (id) => id.toString() === req.user._id.toString()
    );
    
    if (!isEnrolled) {
      return res.status(403).json({
        success: false,
        message: 'You are not enrolled in this class',
      });
    }

    // Check for duplicate attendance (optimized query)
    const existingAttendance = await Attendance.findOne({
      session: session._id,
      student: req.user._id,
    }).select('_id').lean();
    
    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: 'Attendance already marked for this session',
      });
    }
    
    // CRITICAL: DEVICE-BASED PROXY DETECTION
    const deviceFingerprint = deviceInfo?.fingerprint || generateDeviceFingerprint(req);
    
    const deviceProxyCheck = await Attendance.findOne({
      session: session._id,
      'deviceInfo.deviceFingerprint': deviceFingerprint,
      student: { $ne: req.user._id } // Different student
    }).populate('student', 'name studentId').lean();
    
    if (deviceProxyCheck) {
      // BLOCK: Same device trying to mark attendance for different students
      return res.status(403).json({
        success: false,
        message: 'Proxy attendance detected! This device has already been used to mark attendance for another student in this session.',
        details: {
          reason: 'DEVICE_PROXY_DETECTED',
          previousStudent: deviceProxyCheck.student.name,
          previousStudentId: deviceProxyCheck.student.studentId,
          deviceId: deviceFingerprint.substring(0, 12) + '...',
          action: 'BLOCKED'
        },
        errorType: 'PROXY_DETECTION'
      });
    }
    
    // VERIFICATION REQUIREMENTS CHECK
    const isAutoAttendance = autoMarked === true;
    const requirements = session.verificationRequirements || {};
    
    // Validate based on session requirements
    if (!isAutoAttendance) {
      // QR Code verification
      if (requirements.qrCode && !qrToken) {
        return res.status(400).json({
          success: false,
          message: 'QR code verification is required for this session',
        });
      }

      // Face verification — frontend must complete it before calling this endpoint
      if (requirements.faceVerification && !faceVerificationPassed) {
        return res.status(400).json({
          success: false,
          message: 'Face liveness verification is required for this session',
        });
      }

      // Location verification
      if (requirements.locationVerification && (!location || !location.latitude || !location.longitude)) {
        return res.status(400).json({
          success: false,
          message: 'Location verification is required for this session',
          requiresLocation: true,
        });
      }
    }
    
    // LOCATION VALIDATION
    let locationVerification = { verified: true, reason: isAutoAttendance ? 'Auto-attendance - verification skipped' : 'Location not required' };
    
    if (location && location.latitude && location.longitude) {
      if (!validateCoordinates(location.latitude, location.longitude)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid location coordinates provided',
        });
      }
      
      // Geofence check (if session has location)
      if (session.location && session.location.latitude && session.location.longitude) {
        locationVerification = verifyGeofence(session.location, location);
        
        if (!locationVerification.verified && requirements.locationVerification && !isAutoAttendance) {
          return res.status(403).json({
            success: false,
            message: 'Location verification failed',
            details: {
              reason: locationVerification.reason,
              distance: locationVerification.distance,
              allowedRadius: locationVerification.radius,
            },
          });
        }
      }
    }
    
    // FAST ATTENDANCE CREATION
    const deviceDetails = parseUserAgent(req.headers['user-agent']);
    const ipAddress = req.ip || req.connection.remoteAddress;
    
    const attendance = await Attendance.create({
      session: session._id,
      student: req.user._id,
      class: session.class._id,
      qrToken: qrToken || null,
      attendanceSource: isAutoAttendance ? 'AUTO' : qrToken ? 'QR' : 'MANUAL',
      faceVerificationPassed: !!faceVerificationPassed,
      deviceInfo: {
        userAgent: req.headers['user-agent'],
        ip: ipAddress,
        deviceFingerprint,
        browser: deviceDetails.browser,
        os: deviceDetails.os,
        platform: deviceDetails.platform,
        // Initial values - will be updated by background task
        isProxy: false,
        isVPN: false,
        isTor: false,
        riskScore: 0,
      },
      location: location ? {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        verified: locationVerification.verified,
        distance: locationVerification.distance,
        suspicious: false, // Will be updated by background task
      } : undefined,
    });
    
    // Update session attendance count
    const updatedSession = await Session.findByIdAndUpdate(
      session._id, 
      { $inc: { attendanceCount: 1 } },
      { new: true } // Return the updated document
    );
    
    // EMIT REAL-TIME WEBSOCKET UPDATE IMMEDIATELY
    emitAttendanceMarked(
      session._id.toString(),
      session.class._id.toString(),
      req.user._id.toString(),
      {
        studentName: req.user.name,
        riskScore: 0, // Initial value
        attendanceCount: updatedSession.attendanceCount,
        totalStudents: updatedSession.totalStudents
      }
    );
    
    // BACKGROUND SECURITY ANALYSIS (Non-blocking)
    if (!isAutoAttendance) {
      setImmediate(async () => {
        try {
          await performBackgroundSecurityAnalysis(attendance._id, {
            ipAddress,
            location,
            deviceInfo: deviceDetails,
            deviceFingerprint,
            userId: req.user._id,
            sessionId: session._id,
            classId: session.class._id
          });
        } catch (error) {
          console.error('Background security analysis failed:', error);
        }
      });
    }
    
    // Log to audit trail (async)
    setImmediate(async () => {
      try {
        await createAuditLog(
          req,
          'ATTENDANCE_MARK',
          'Attendance',
          attendance._id,
          {
            sessionId: session._id,
            classId: session.class._id,
            locationVerified: locationVerification.verified,
            deviceFingerprint: deviceFingerprint.substring(0, 12) + '...',
            verificationMethod: isAutoAttendance ? 'AUTO' : qrToken ? 'QR' : 'MANUAL',
          }
        );
      } catch (error) {
        console.error('Audit log creation failed:', error);
      }
    });
    
    // FAST RESPONSE - Return immediately
    res.status(201).json({
      success: true,
      message: isAutoAttendance 
        ? '✅ Auto-attendance marked successfully!' 
        : '✅ Attendance marked successfully!',
      data: { 
        attendance,
        locationVerification: {
          verified: locationVerification.verified,
          distance: locationVerification.distance,
          message: locationVerification.reason,
        },
        verificationStatus: {
          qrCode: qrToken ? 'Verified' : 'Not Required',
          faceVerification: requirements.faceVerification ? 'Required' : 'Not Required',
          locationVerification: requirements.locationVerification ? 'Verified' : 'Not Required',
          autoAttendance: isAutoAttendance,
        },
        studentName: req.user.name,
        sessionTitle: session.title,
        className: session.class.name,
        isAutoAttendance,
        processingTime: 'Optimized for performance',
      },
    });
  } catch (error) {
    console.error('Attendance marking error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get student attendance history
 */
export const getStudentAttendance = async (req, res) => {
  try {
    const { classId } = req.query;
    let query = { student: req.user._id };
    
    if (classId) query.class = classId;
    
    const attendance = await Attendance.find(query)
      .populate('session', 'title date startTime')
      .populate('class', 'name code')
      .sort('-createdAt');
    
    res.json({
      success: true,
      data: { attendance },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get attendance statistics for student
 */
export const getAttendanceStats = async (req, res) => {
  try {
    const { classId } = req.query;
    
    // Get all sessions for the class
    const sessions = await Session.find({
      class: classId,
      status: { $in: ['COMPLETED', 'LIVE'] },
    });
    
    // Get student's attendance
    const attendance = await Attendance.find({
      student: req.user._id,
      class: classId,
    });
    
    const totalSessions = sessions.length;
    const attendedSessions = attendance.length;
    const percentage = totalSessions > 0 
      ? ((attendedSessions / totalSessions) * 100).toFixed(2)
      : 0;
    
    res.json({
      success: true,
      data: {
        totalSessions,
        attendedSessions,
        missedSessions: totalSessions - attendedSessions,
        percentage,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get class attendance report (Faculty/Admin) - OPTIMIZED WITH AGGREGATION
 */
export const getClassAttendanceReport = async (req, res) => {
  try {
    const { classId } = req.params;
    
    const classData = await Class.findById(classId).populate('students', 'name email studentId');
    
    if (!classData) {
      return res.status(404).json({
        success: false,
        message: 'Class not found',
      });
    }
    
    // Get total sessions count
    const totalSessions = await Session.countDocuments({
      class: classId,
      status: { $in: ['COMPLETED', 'LIVE'] },
    });
    
    // OPTIMIZED: Use aggregation pipeline to get attendance counts per student
    const attendanceAggregation = await Attendance.aggregate([
      {
        $match: { class: new mongoose.Types.ObjectId(classId) }
      },
      {
        $group: {
          _id: '$student',
          attended: { $sum: 1 }
        }
      }
    ]);
    
    // Create a map for quick lookup
    const attendanceMap = new Map(
      attendanceAggregation.map(a => [a._id.toString(), a.attended])
    );
    
    // Build report with O(n) complexity instead of O(n*m)
    const report = classData.students.map(student => {
      const attended = attendanceMap.get(student._id.toString()) || 0;
      const percentage = totalSessions > 0
        ? ((attended / totalSessions) * 100).toFixed(2)
        : 0;
      
      return {
        student: {
          _id: student._id,
          name: student.name,
          email: student.email,
          studentId: student.studentId,
        },
        totalSessions,
        attended,
        missed: totalSessions - attended,
        percentage,
        status: percentage < 75 ? 'AT_RISK' : 'GOOD',
      };
    }).sort((a, b) => a.percentage - b.percentage);
    
    res.json({
      success: true,
      data: {
        class: classData,
        report,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get peer cluster data for a session (Admin/Faculty)
 */
export const getPeerCluster = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    const { calculatePeerCluster } = await import('../utils/smartValidation.js');
    const clusterData = await calculatePeerCluster(sessionId);

    res.json({
      success: true,
      data: clusterData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get analytics data (Admin)
 */
export const getAnalytics = async (req, res) => {
  try {
    const totalStudents = await User.countDocuments({ role: 'STUDENT' });
    const totalClasses = await Class.countDocuments();
    const totalSessions = await Session.countDocuments();
    const totalAttendance = await Attendance.countDocuments();
    
    // Get at-risk students (< 75% attendance) - using aggregation to avoid N+1 queries
    const [sessionCounts, attendanceCounts] = await Promise.all([
      Session.aggregate([
        { $match: { status: { $in: ['COMPLETED', 'LIVE'] } } },
        { $group: { _id: '$class', count: { $sum: 1 } } },
      ]),
      Attendance.aggregate([
        { $group: { _id: { class: '$class', student: '$student' }, count: { $sum: 1 } } },
      ]),
    ]);

    const sessionCountMap = new Map(sessionCounts.map((s) => [s._id.toString(), s.count]));
    const attendanceCountMap = new Map(
      attendanceCounts.map((a) => [`${a._id.class}-${a._id.student}`, a.count])
    );

    const classes = await Class.find().populate('students', 'name email studentId');
    const atRiskStudents = [];

    for (const classData of classes) {
      const totalSessions = sessionCountMap.get(classData._id.toString()) || 0;
      if (totalSessions === 0) continue;

      for (const student of classData.students) {
        const attended = attendanceCountMap.get(`${classData._id}-${student._id}`) || 0;
        const percentage = (attended / totalSessions) * 100;

        if (percentage < 75) {
          atRiskStudents.push({
            student,
            class: classData,
            percentage: percentage.toFixed(2),
          });
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        overview: {
          totalStudents,
          totalClasses,
          totalSessions,
          totalAttendance,
        },
        atRiskStudents,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// Helper function to find nearby session for auto-attendance
const findNearbySession = async (studentId, location) => {
  try {
    // Same query logic as checkNearbySession — use verificationRequirements,
    // not location.geofencingEnabled (which is often never set by the faculty UI)
    const liveSessions = await Session.find({
      status: 'LIVE',
      'verificationRequirements.locationVerification': true,
      'verificationRequirements.qrCode': { $ne: true },
    }).populate('class', 'name code students').lean();

    if (liveSessions.length === 0) return null;

    for (const session of liveSessions) {
      const isEnrolled = session.class.students.some(
        (id) => id.toString() === studentId.toString()
      );
      if (!isEnrolled) continue;

      // If session has coordinates, do a geofence check
      if (session.location?.latitude && session.location?.longitude) {
        const verification = verifyGeofence(session.location, location);
        if (verification.verified) return session;
      } else {
        // No coordinates configured — allow from any location
        return session;
      }
    }

    return null;
  } catch (error) {
    console.error('Error finding nearby session:', error);
    return null;
  }
};

// Background security analysis function (non-blocking)
const performBackgroundSecurityAnalysis = async (attendanceId, analysisData) => {
  try {
    const { ipAddress, location, deviceInfo, deviceFingerprint, userId, sessionId, classId } = analysisData;
    
    // Perform all heavy security checks
    let proxyCheck = { isProxy: false, isVPN: false, isTor: false, riskScore: 0 };
    let residentialProxyCheck = { isResidentialProxy: false, riskScore: 0 };
    let ipReputation = { score: 0, isDatacenter: false, threatLevel: 'LOW' };
    let spoofingDetection = { isSuspicious: false };
    
    // Parallel execution of security checks
    const securityChecks = await Promise.allSettled([
      safeProxyCheck(ipAddress),
      detectResidentialProxy(ipAddress, userId),
      calculateIPReputation(ipAddress),
      location ? detectLocationSpoofing(location) : Promise.resolve({ isSuspicious: false }),
      location ? validatePeerLocation(sessionId, location) : Promise.resolve({ isPeerOutlier: false }),
      location ? detectImpossibleTravel(userId, location, new Date()) : Promise.resolve({ isImpossibleTravel: false })
    ]);
    
    // Process results
    if (securityChecks[0].status === 'fulfilled') proxyCheck = securityChecks[0].value;
    if (securityChecks[1].status === 'fulfilled') residentialProxyCheck = securityChecks[1].value;
    if (securityChecks[2].status === 'fulfilled') ipReputation = securityChecks[2].value;
    if (securityChecks[3].status === 'fulfilled') spoofingDetection = securityChecks[3].value;
    
    // Get previous devices for suspicious device detection
    const previousAttendances = await Attendance.find({
      student: userId,
    }).limit(10).select('deviceInfo').lean();
    
    const suspiciousDevice = detectSuspiciousDevice(
      { ...deviceInfo, deviceFingerprint, ...proxyCheck },
      previousAttendances.map(a => a.deviceInfo)
    );
    
    // Calculate total risk score
    let totalRiskScore = Math.max(proxyCheck.riskScore, suspiciousDevice.riskScore);
    const riskFactors = [];
    
    if (proxyCheck.isProxy) {
      totalRiskScore += RISK_FACTOR_SCORES.PROXY_DETECTED;
      riskFactors.push('PROXY_DETECTED');
    }
    if (proxyCheck.isVPN) {
      totalRiskScore += RISK_FACTOR_SCORES.VPN_DETECTED;
      riskFactors.push('VPN_DETECTED');
    }
    if (proxyCheck.isTor) {
      totalRiskScore += RISK_FACTOR_SCORES.TOR_DETECTED;
      riskFactors.push('TOR_DETECTED');
    }
    if (residentialProxyCheck.isResidentialProxy) {
      totalRiskScore += RISK_FACTOR_SCORES.RESIDENTIAL_PROXY;
      riskFactors.push('RESIDENTIAL_PROXY');
    }
    if (ipReputation.isDatacenter) {
      totalRiskScore += RISK_FACTOR_SCORES.DATACENTER_IP;
      riskFactors.push('DATACENTER_IP');
    }
    if (spoofingDetection.isSuspicious) {
      totalRiskScore += RISK_FACTOR_SCORES.LOCATION_SPOOFING;
      riskFactors.push('LOCATION_SPOOFING');
    }
    if (suspiciousDevice.isSuspicious) {
      totalRiskScore += RISK_FACTOR_SCORES.SUSPICIOUS_DEVICE;
      riskFactors.push('SUSPICIOUS_DEVICE');
    }
    
    // Handle peer validation and travel detection results
    if (securityChecks[4].status === 'fulfilled' && securityChecks[4].value.isPeerOutlier) {
      totalRiskScore += securityChecks[4].value.riskScore;
      riskFactors.push('PEER_LOCATION_OUTLIER');
    }
    
    if (securityChecks[5].status === 'fulfilled' && securityChecks[5].value.isImpossibleTravel) {
      totalRiskScore += securityChecks[5].value.riskScore;
      riskFactors.push('IMPOSSIBLE_TRAVEL');
    }
    
    totalRiskScore = Math.min(totalRiskScore, 100);
    
    // Update attendance record with security analysis results
    await Attendance.findByIdAndUpdate(attendanceId, {
      $set: {
        'deviceInfo.isProxy': proxyCheck.isProxy,
        'deviceInfo.isVPN': proxyCheck.isVPN,
        'deviceInfo.isTor': proxyCheck.isTor,
        'deviceInfo.riskScore': totalRiskScore,
        'location.suspicious': spoofingDetection.isSuspicious || suspiciousDevice.isSuspicious,
      }
    });
    
    // Create alert if risk score exceeds threshold
    if (totalRiskScore >= ALERT_CREATION_THRESHOLD) {
      const severity = totalRiskScore >= 85 ? 'CRITICAL' : totalRiskScore >= 70 ? 'HIGH' : 'MEDIUM';
      
      const alert = await Alert.create({
        student: userId,
        attendance: attendanceId,
        session: sessionId,
        class: classId,
        riskScore: totalRiskScore,
        riskFactors,
        severity,
        status: 'PENDING',
        deviceInfo: {
          ip: ipAddress,
          userAgent: deviceInfo.userAgent,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          deviceFingerprint,
        },
        locationInfo: location ? {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
        } : undefined,
      });
      
      // Create verification queue entry
      await VerificationQueue.create({
        alert: alert._id,
        student: userId,
        attendance: attendanceId,
        priority: Math.floor(totalRiskScore / 10),
      });
      
      // Emit real-time alert to all admins
      const populatedAlert = await Alert.findById(alert._id)
        .populate('student', 'name email studentId')
        .populate('session', 'name')
        .populate('class', 'name');
      
      const io = getIO();
      if (io) {
        io.emit('new-alert', {
          alert: populatedAlert,
          timestamp: new Date(),
        });
      }
    }
    
    console.log(`✅ Background security analysis completed for attendance ${attendanceId} - Risk Score: ${totalRiskScore}`);
    
  } catch (error) {
    console.error('Background security analysis failed:', error);
  }
};
