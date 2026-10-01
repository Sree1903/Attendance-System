import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import axiosInstance from '../utils/axiosInstance';
import {
  MapPin,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Users,
  Navigation,
} from 'lucide-react';
import { getDeviceInfo } from '../utils/deviceFingerprint';
import {
  SUCCESS_MESSAGE_DELAY,
  REDIRECT_DELAY,
  LOCATION_TIMEOUT,
} from '../lib/constants';

export default function AutoAttendance() {
  const navigate = useNavigate();

  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('checking');
  const [locationError, setLocationError] = useState('');
  const [nearbySession, setNearbySession] = useState(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [attendanceMarked, setAttendanceMarked] = useState(false);
  const [currentAccuracy, setCurrentAccuracy] = useState(null);

  const watchIdRef = useRef(null);
  const timeoutRef = useRef(null);
  const bestPositionRef = useRef(null);

  // Clean up GPS watcher and timeout
  const cleanupLocationWatcher = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Finish location collection using the best reading
  const finishLocationCapture = () => {
    const bestPosition = bestPositionRef.current;

    cleanupLocationWatcher();
    setLocationStatus(bestPosition ? 'granted' : 'denied');

    if (!bestPosition) {
      setLocationError(
        'Could not obtain a GPS location. Please try again.'
      );
      setMessage(
        '❌ Could not obtain a reliable location. Please try again.'
      );
      setMessageType('error');
      return null;
    }

    const { latitude, longitude, accuracy } = bestPosition.coords;

    const locationData = {
      latitude,
      longitude,
      accuracy,
      timestamp: bestPosition.timestamp,
    };

    setLocation(locationData);
    setCurrentAccuracy(accuracy);

    // Do not reject here yet.
    // The backend will perform the final geofence/accuracy verification.
    if (accuracy > 50) {
      setLocationError(
        `GPS accuracy is approximately ±${Math.round(
          accuracy
        )}m. Precise Location is recommended for reliable attendance verification.`
      );

      setMessage(
        `⚠️ Location found, but accuracy is ±${Math.round(
          accuracy
        )}m. Precise Location is recommended.`
      );
      setMessageType('info');
    } else {
      setLocationError('');
      setMessage(
        `✅ Location acquired with approximately ±${Math.round(
          accuracy
        )}m accuracy.`
      );
      setMessageType('success');
    }

    return locationData;
  };

  // Get the best available location
  const getLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        setLocationStatus('unavailable');
        setLocationError(
          'Geolocation is not supported by your browser'
        );
        setMessage('❌ Geolocation is not supported by your browser.');
        setMessageType('error');
        reject(new Error('Geolocation not supported'));
        return;
      }

      cleanupLocationWatcher();

      setLocationStatus('checking');
      setLocationError('');
      setCurrentAccuracy(null);
      bestPositionRef.current = null;

      setMessage('📍 Finding your most accurate location...');
      setMessageType('info');

      // Give the device up to 15 seconds to improve GPS accuracy
      timeoutRef.current = setTimeout(() => {
        const result = finishLocationCapture();

        if (result) {
          resolve(result);
        } else {
          reject(new Error('Could not obtain location'));
        }
      }, 15000);

      const handlePosition = (position) => {
        const accuracy = position.coords.accuracy;

        // Keep the best reading
        if (
          !bestPositionRef.current ||
          accuracy < bestPositionRef.current.coords.accuracy
        ) {
          bestPositionRef.current = position;
          setCurrentAccuracy(accuracy);

          setMessage(
            `📡 Improving location accuracy... Current: ±${Math.round(
              accuracy
            )}m`
          );
          setMessageType('info');

          // Good enough for our first-stage location capture
          if (accuracy <= 20) {
            const result = finishLocationCapture();

            if (result) {
              resolve(result);
            } else {
              reject(new Error('Could not obtain location'));
            }
          }
        }
      };

      const handleError = (error) => {
        cleanupLocationWatcher();
        setLocationStatus('denied');

        let errorMsg = 'Location access denied';

        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMsg =
              'Location permission denied. Please allow location access.';
            break;

          case error.POSITION_UNAVAILABLE:
            errorMsg =
              'Location information is currently unavailable. Please try again.';
            break;

          case error.TIMEOUT:
            errorMsg =
              'Location request timed out. Please try again.';
            break;

          default:
            errorMsg = 'An unknown location error occurred.';
        }

        setLocationError(errorMsg);
        setMessage(`❌ ${errorMsg}`);
        setMessageType('error');

        reject(error);
      };

      watchIdRef.current = navigator.geolocation.watchPosition(
        handlePosition,
        handleError,
        {
          enableHighAccuracy: true,
          timeout: Math.max(LOCATION_TIMEOUT, 15000),
          maximumAge: 0,
        }
      );
    });
  };

  // Check for nearby sessions
  const checkNearbySession = async (locationData) => {
    try {
      setMessage('🔍 Checking for nearby sessions...');
      setMessageType('info');

      const { data } = await axiosInstance.post(
        '/attendance/check-nearby',
        {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          accuracy: locationData.accuracy,
        }
      );

      if (data.data.session) {
        setNearbySession(data.data);

        if (data.data.alreadyMarked) {
          setMessage(
            `ℹ️ Attendance already marked for "${data.data.session.title}"`
          );
          setMessageType('info');
        } else if (data.data.withinRange) {
          setMessage(
            `✅ Session found! You can mark auto-attendance for "${data.data.session.title}"`
          );
          setMessageType('success');
        } else {
          const distanceText =
            data.data.distance !== null
              ? `you're ${Math.round(
                  data.data.distance
                )}m away (max: ${
                  data.data.session.location?.radius || 100
                }m)`
              : 'location not configured by instructor';

          setMessage(
            `📍 Session "${data.data.session.title}" found but ${distanceText}`
          );
          setMessageType('info');
        }
      } else {
        setMessage(
          'ℹ️ No active location-based sessions found for your enrolled classes'
        );
        setMessageType('info');
      }
    } catch (error) {
      setMessage(
        `❌ Error checking nearby sessions: ${
          error.response?.data?.message || error.message
        }`
      );
      setMessageType('error');
    }
  };

  // Mark auto attendance
  const markAutoAttendance = async () => {
    if (
      isProcessing ||
      attendanceMarked ||
      !nearbySession ||
      !location
    ) {
      return;
    }

    try {
      setIsProcessing(true);
      setMessage('⚡ Marking auto-attendance...');
      setMessageType('info');

      const deviceInfo = getDeviceInfo();
      const startTime = Date.now();

      // Auto-attendance uses the location already collected above
      const { data } = await axiosInstance.post('/attendance/mark', {
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          timestamp: location.timestamp,
        },
        deviceInfo,
        autoMarked: true,
      });

      const processingTime = Date.now() - startTime;

      setAttendanceMarked(true);

      const distLine =
        nearbySession.distance !== null
          ? `📍 Distance: ${Math.round(
              nearbySession.distance
            )}m\n`
          : '';

      const accuracyLine =
        location.accuracy !== null
          ? `🎯 GPS Accuracy: ±${Math.round(
              location.accuracy
            )}m\n`
          : '';

      const successMsg = `🎉 AUTO-ATTENDANCE MARKED SUCCESSFULLY!\n\n📚 Session: ${data.data.sessionTitle}\n🏫 Class: ${data.data.className}\n👤 Student: ${data.data.studentName}\n${distLine}${accuracyLine}⚡ Processing Time: ${processingTime}ms`;

      setMessage(successMsg);
      setMessageType('success');

      // Redirect to dashboard
      setTimeout(() => {
        setMessage('✅ Redirecting to dashboard...');

        setTimeout(() => {
          navigate('/student', {
            state: {
              refresh: true,
              attendanceMarked: true,
            },
          });
        }, REDIRECT_DELAY);
      }, SUCCESS_MESSAGE_DELAY);
    } catch (error) {
      const errorData = error.response?.data;

      setIsProcessing(false);

      // Handle specific proxy detection error
      if (errorData?.errorType === 'PROXY_DETECTION') {
        setMessage(
          `🚫 PROXY ATTENDANCE BLOCKED!\n\n${errorData.message}\n\n📱 Device: ${errorData.details.deviceId}\n👤 Previous Student: ${errorData.details.previousStudent} (${errorData.details.previousStudentId})\n\n⚠️ Each device can only mark attendance for ONE student per session.`
        );
      } else {
        setMessage(
          `❌ ${
            errorData?.message ||
            'Failed to mark auto-attendance. Please try again.'
          }`
        );
      }

      setMessageType('error');
    }
  };

  // Refresh location and check for sessions
  const refreshLocation = async () => {
    try {
      const locationData = await getLocation();
      await checkNearbySession(locationData);
    } catch (error) {
      console.error('Failed to refresh location:', error);
    }
  };

  // Initialize auto-attendance flow
  useEffect(() => {
    const initializeAutoAttendance = async () => {
      try {
        const locationData = await getLocation();
        await checkNearbySession(locationData);
      } catch (error) {
        console.error(
          'Failed to initialize auto-attendance:',
          error
        );
      }
    };

    initializeAutoAttendance();

    return () => {
      cleanupLocationWatcher();
    };
  }, []);

  const getAccuracyLabel = (accuracy) => {
    if (!accuracy) return '';

    if (accuracy <= 10) return 'Excellent';
    if (accuracy <= 25) return 'Good';
    if (accuracy <= 50) return 'Acceptable';

    return 'Poor';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <div className="flex">
        <Sidebar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="max-w-2xl mx-auto">

            {/* Header */}
            <div className="mb-6 sm:mb-8">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                Auto Attendance
              </h1>

              <p className="text-gray-600 dark:text-gray-400 mt-2 text-sm sm:text-base">
                Automatic attendance marking based on your location
              </p>
            </div>

            {/* Location Status */}
            <div
              className={`mb-4 sm:mb-6 p-3 sm:p-4 rounded-lg flex items-center space-x-2 ${
                locationStatus === 'granted'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                  : locationStatus === 'denied'
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                  : locationStatus === 'checking'
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400'
                  : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400'
              }`}
            >
              <MapPin size={18} className="flex-shrink-0" />

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">
                  {locationStatus === 'granted' &&
                    'Location Access Granted'}

                  {locationStatus === 'denied' &&
                    'Location Access Denied'}

                  {locationStatus === 'checking' &&
                    'Finding Best Location...'}

                  {locationStatus === 'unavailable' &&
                    'Location Unavailable'}
                </p>

                {location &&
                  locationStatus === 'granted' &&
                  location.accuracy !== null && (
                    <div className="flex items-center gap-2 mt-1">
                      <Navigation size={14} />

                      <p className="text-xs sm:text-sm">
                        Accuracy: ±
                        {Math.round(location.accuracy)}m
                        {' · '}
                        {getAccuracyLabel(location.accuracy)}
                      </p>
                    </div>
                  )}

                {!location &&
                  locationStatus === 'checking' &&
                  currentAccuracy !== null && (
                    <p className="text-xs sm:text-sm mt-1">
                      Current GPS accuracy: ±
                      {Math.round(currentAccuracy)}m
                    </p>
                  )}

                {locationError && (
                  <p className="text-xs sm:text-sm mt-1 break-words">
                    {locationError}
                  </p>
                )}
              </div>

              {locationStatus === 'denied' && (
                <button
                  onClick={refreshLocation}
                  className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 flex-shrink-0"
                >
                  Retry
                </button>
              )}
            </div>

            {/* Status Message */}
            {message && (
              <div
                className={`mb-4 sm:mb-6 p-3 sm:p-4 rounded-lg ${
                  messageType === 'success'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                    : messageType === 'info'
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400'
                    : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                }`}
              >
                <div className="flex items-start space-x-2">
                  <div className="flex-shrink-0 mt-0.5">
                    {messageType === 'success' ? (
                      <CheckCircle size={18} />
                    ) : messageType === 'info' ? (
                      <AlertTriangle size={18} />
                    ) : (
                      <XCircle size={18} />
                    )}
                  </div>

                  <span className="whitespace-pre-line text-sm sm:text-base leading-relaxed">
                    {message}
                  </span>
                </div>
              </div>
            )}

            {/* Nearby Session Card */}
            {nearbySession && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="card-elevated p-6 mb-6"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
                    <MapPin
                      className="text-white"
                      size={24}
                    />
                  </div>

                  <div className="flex-1">
                    <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-2">
                      {nearbySession.session.title}
                    </h3>

                    <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                      <div className="flex items-center gap-2">
                        <Users size={16} />
                        <span>
                          {nearbySession.session.class.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <MapPin size={16} />

                        <span>
                          {nearbySession.distance !== null
                            ? `Distance: ${Math.round(
                                nearbySession.distance
                              )}m`
                            : 'Location: No coordinates set'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Navigation size={16} />

                        <span>
                          GPS Accuracy:{' '}
                          {location?.accuracy !== null &&
                          location?.accuracy !== undefined
                            ? `±${Math.round(
                                location.accuracy
                              )}m`
                            : 'Unknown'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Clock size={16} />

                        <span>
                          Status: {nearbySession.session.status}
                        </span>
                      </div>
                    </div>

                    {nearbySession.withinRange &&
                      !nearbySession.alreadyMarked &&
                      !attendanceMarked && (
                        <div className="mt-4">
                          <button
                            onClick={markAutoAttendance}
                            disabled={isProcessing}
                            className="btn-primary flex items-center space-x-2"
                          >
                            <CheckCircle size={20} />

                            <span>
                              {isProcessing
                                ? 'Marking...'
                                : 'Mark Auto Attendance'}
                            </span>
                          </button>
                        </div>
                      )}

                    {nearbySession.alreadyMarked && (
                      <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded-lg">
                        <p className="text-sm font-medium">
                          ✅ Attendance already marked for this
                          session
                        </p>
                      </div>
                    )}

                    {!nearbySession.withinRange && (
                      <div className="mt-4 p-3 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded-lg">
                        <p className="text-sm font-medium">
                          📍 You need to be within{' '}
                          {nearbySession.session.location
                            ?.radius || 100}
                          m to mark auto-attendance
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Refresh Button */}
            <div className="text-center">
              <button
                onClick={refreshLocation}
                disabled={locationStatus === 'checking'}
                className="btn-secondary flex items-center space-x-2 mx-auto"
              >
                <MapPin size={20} />

                <span>
                  {locationStatus === 'checking'
                    ? 'Finding Location...'
                    : 'Refresh Location'}
                </span>
              </button>
            </div>

            {/* Info Card */}
            <div className="mt-8 card-elevated p-6">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4">
                📍 How Auto Attendance Works
              </h3>

              <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    1
                  </div>

                  <p>
                    Your browser collects multiple GPS readings
                    to find the most accurate location available.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    2
                  </div>

                  <p>
                    The system checks for active sessions with
                    location verification enabled.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    3
                  </div>

                  <p>
                    Your GPS accuracy is recorded along with your
                    coordinates.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    4
                  </div>

                  <p>
                    If you're within the session's geofence, you
                    can mark attendance automatically.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    5
                  </div>

                  <p>
                    Precise Location is recommended for reliable
                    geofence verification.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
