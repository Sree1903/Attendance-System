import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, QrCode, X, Navigation, Clock } from 'lucide-react';
import axiosInstance from '../utils/axiosInstance';

export default function SessionNearbyNotification() {
  const navigate = useNavigate();
  const [nearbySession, setNearbySession] = useState(null);
  const [distance, setDistance] = useState(null);
  const lastCheckRef = useRef(0);
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const watchIdRef = useRef(null);
  const checkIntervalRef = useRef(null);

  useEffect(() => {
    startLocationWatch();

    return () => {
      stopLocationWatch();
    };
  }, []);

  const startLocationWatch = () => {
    if (!navigator.geolocation) {
      console.log('Geolocation not supported');
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };

        checkNearbySession(location);
      },
      (error) => {
        console.error('Location error:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 15000,
      }
    );

    checkIntervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          };

          checkNearbySession(location);
        },
        (error) => console.error('Location check error:', error),
        {
          enableHighAccuracy: true,
          timeout: 30000,
          maximumAge: 15000,
        }
      );
    }, 120000);
  };

  const stopLocationWatch = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
  };

  const checkNearbySession = async (location) => {
    if (dismissed) return;

    // Prevent excessive API requests when the browser sends
    // several GPS updates close together.
    const now = Date.now();

    if (now - lastCheckRef.current < 5000) {
      return;
    }

    lastCheckRef.current = now;

    try {
      const { data } = await axiosInstance.post(
        '/attendance/check-nearby',
        {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
        }
      );

      if (
        data.data.session &&
        data.data.withinRange &&
        !data.data.alreadyMarked
      ) {
        setNearbySession(data.data.session);
        setDistance(data.data.distance);
        setShow(true);

        if (
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          new Notification('Session Nearby!', {
            body: `${data.data.session.title} - ${Math.round(
              data.data.distance
            )}m away`,
            icon: '/logo.svg',
            tag: 'session-nearby',
          });
        }
      } else {
        setShow(false);
        setNearbySession(null);
      }
    } catch (error) {
      console.error(
        'Error checking nearby sessions:',
        error
      );
    }
  };

  const handleMarkAttendance = () => {
    setShow(false);
    navigate('/scan-qr');
  };

  const handleDismiss = () => {
    setShow(false);
    setDismissed(true);

    // Re-enable after 10 minutes
    setTimeout(() => setDismissed(false), 600000);
  };

  useEffect(() => {
    if (
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission();
    }
  }, []);

  return (
    <AnimatePresence>
      {show && nearbySession && (
        <motion.div
          initial={{
            opacity: 0,
            y: -100,
            scale: 0.9,
          }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
          }}
          exit={{
            opacity: 0,
            y: -100,
            scale: 0.9,
          }}
          className="fixed top-20 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]"
        >
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl shadow-2xl p-4 border-2 border-green-300">
            {/* Close button */}
            <button
              onClick={handleDismiss}
              className="absolute top-2 right-2 p-1 hover:bg-white/20 rounded-full transition-colors"
            >
              <X size={18} />
            </button>

            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <MapPin
                  size={24}
                  className="animate-pulse"
                />
              </div>

              <div>
                <h3 className="font-bold text-lg">
                  Session Nearby!
                </h3>

                <p className="text-xs text-green-100">
                  You're close to an active session
                </p>
              </div>
            </div>

            {/* Session info */}
            <div className="bg-white/10 rounded-lg p-3 mb-3 backdrop-blur-sm">
              <h4 className="font-semibold mb-1">
                {nearbySession.title}
              </h4>

              <p className="text-sm text-green-100 mb-2">
                {nearbySession.class?.name}
              </p>

              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1">
                  <Navigation size={14} />

                  <span>
                    {Math.round(distance)}m away
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <Clock size={14} />

                  <span>Live now</span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleMarkAttendance}
                className="flex-1 flex items-center justify-center gap-2 bg-white text-green-600 font-semibold py-2 px-4 rounded-lg hover:bg-green-50 transition-colors"
              >
                <QrCode size={18} />

                <span>Mark Attendance</span>
              </button>

              <button
                onClick={handleDismiss}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-sm"
              >
                Later
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
