import { useState, useEffect, useRef } from 'react';
import { MapPin, Target, Check, X, Navigation } from 'lucide-react';
import { motion } from 'framer-motion';

export default function LocationPicker({ value, onChange, required = false }) {
  const [location, setLocation] = useState(value || {
    latitude: null,
    longitude: null,
    accuracy: null,
    radius: 100,
    room: '',
    building: '',
  });

  const [gettingLocation, setGettingLocation] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [locationAccuracy, setLocationAccuracy] = useState(
    value?.accuracy || null
  );

  const watchIdRef = useRef(null);
  const timeoutRef = useRef(null);
  const bestPositionRef = useRef(null);

  useEffect(() => {
    if (onChange) {
      onChange(location);
    }
  }, [location, onChange]);

  // Clean up GPS watcher and timer
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

  // Get the best available GPS reading
  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }

    setGettingLocation(true);
    setLocationError('');
    bestPositionRef.current = null;

    // Stop after 15 seconds even if GPS keeps providing readings
    timeoutRef.current = setTimeout(() => {
      finishLocationCapture();
    }, 15000);

    const handlePosition = (position) => {
      const accuracy = position.coords.accuracy;

      // Keep the reading with the smallest accuracy value
      if (
        !bestPositionRef.current ||
        accuracy < bestPositionRef.current.coords.accuracy
      ) {
        bestPositionRef.current = position;

        // Show live accuracy to the faculty member
        setLocationAccuracy(accuracy);

        // If we already have a very good reading, we can finish early
        if (accuracy <= 20) {
          finishLocationCapture();
        }
      }
    };

    const handleError = (error) => {
      cleanupLocationWatcher();
      setGettingLocation(false);

      let errorMsg = 'Failed to get location';

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
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const finishLocationCapture = () => {
    const bestPosition = bestPositionRef.current;

    cleanupLocationWatcher();
    setGettingLocation(false);

    if (!bestPosition) {
      setLocationError(
        'Could not obtain a GPS location. Please try again.'
      );
      return;
    }

    const { latitude, longitude, accuracy } = bestPosition.coords;

    const newLocation = {
      ...location,
      latitude,
      longitude,
      accuracy,
    };

    setLocation(newLocation);
    setLocationAccuracy(accuracy);

    // Warn, but do not automatically reject the location.
    if (accuracy > 50) {
      setLocationError(
        `Location captured, but GPS accuracy is approximately ±${Math.round(
          accuracy
        )}m. For better geofencing, enable Precise Location and try again.`
      );
    }
  };

  const clearLocation = () => {
    cleanupLocationWatcher();

    setLocation({
      ...location,
      latitude: null,
      longitude: null,
      accuracy: null,
    });

    setLocationAccuracy(null);
    setLocationError('');
  };

  // Cleanup when component is unmounted
  useEffect(() => {
    return () => {
      cleanupLocationWatcher();
    };
  }, []);

  const hasLocation =
    location.latitude !== null &&
    location.longitude !== null;

  const getAccuracyLabel = (accuracy) => {
    if (!accuracy) return '';

    if (accuracy <= 10) {
      return 'Excellent';
    }

    if (accuracy <= 25) {
      return 'Good';
    }

    if (accuracy <= 50) {
      return 'Acceptable';
    }

    return 'Poor';
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="space-y-4 pt-4 border-t border-gray-700"
    >
      {/* Room and Building */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-2 text-gray-300">
            Room Number
          </label>

          <input
            type="text"
            value={location.room}
            onChange={(e) =>
              setLocation({
                ...location,
                room: e.target.value,
              })
            }
            placeholder="e.g., 101"
            className="w-full px-4 py-3 bg-[#0f1420] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2 text-gray-300">
            Building
          </label>

          <input
            type="text"
            value={location.building}
            onChange={(e) =>
              setLocation({
                ...location,
                building: e.target.value,
              })
            }
            placeholder="e.g., Main Building"
            className="w-full px-4 py-3 bg-[#0f1420] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
          />
        </div>
      </div>

      {/* Location Coordinates */}
      <div>
        <label className="block text-sm font-semibold mb-2 text-gray-300">
          GPS Coordinates{' '}
          {required && <span className="text-red-500">*</span>}
        </label>

        {hasLocation ? (
          <div className="p-4 bg-green-900/20 border border-green-700 rounded-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <Check
                  className="text-green-400 mt-1"
                  size={20}
                />

                <div>
                  <p className="font-medium text-green-300">
                    Location Set
                  </p>

                  <p className="text-sm text-green-400 mt-1">
                    Lat: {location.latitude.toFixed(6)}, Lon:{' '}
                    {location.longitude.toFixed(6)}
                  </p>

                  {locationAccuracy && (
                    <div className="flex items-center gap-2 mt-2">
                      <Navigation
                        size={15}
                        className={
                          locationAccuracy <= 25
                            ? 'text-green-400'
                            : locationAccuracy <= 50
                            ? 'text-yellow-400'
                            : 'text-red-400'
                        }
                      />

                      <p
                        className={`text-sm ${
                          locationAccuracy <= 25
                            ? 'text-green-400'
                            : locationAccuracy <= 50
                            ? 'text-yellow-400'
                            : 'text-red-400'
                        }`}
                      >
                        GPS Accuracy: ±
                        {Math.round(locationAccuracy)}m (
                        {getAccuracyLabel(locationAccuracy)})
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={clearLocation}
                className="p-1 hover:bg-green-900/40 rounded transition-colors"
              >
                <X
                  className="text-green-400"
                  size={18}
                />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={getCurrentLocation}
            disabled={gettingLocation}
            className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Target size={20} />

            <span>
              {gettingLocation
                ? `Finding Best Location${
                    locationAccuracy
                      ? ` (±${Math.round(locationAccuracy)}m)`
                      : ''
                  }...`
                : '🎯 Get Current Location'}
            </span>
          </button>
        )}

        {gettingLocation && (
          <p className="text-sm text-blue-400 mt-2">
            📡 Improving GPS accuracy... Please keep the location
            permission enabled and wait a few seconds.
          </p>
        )}

        {locationError && (
          <p
            className={`text-sm mt-2 ${
              hasLocation && locationAccuracy <= 50
                ? 'text-yellow-400'
                : 'text-red-400'
            }`}
          >
            {locationError}
          </p>
        )}
      </div>

      {/* Radius Slider */}
      <div>
        <label className="block text-sm font-semibold mb-2 text-gray-300">
          Geofence Radius: {location.radius}m
        </label>

        <input
          type="range"
          min="25"
          max="500"
          step="25"
          value={location.radius}
          onChange={(e) =>
            setLocation({
              ...location,
              radius: parseInt(e.target.value),
            })
          }
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-600"
          style={{
            background: `linear-gradient(
              to right,
              rgb(147, 51, 234) 0%,
              rgb(147, 51, 234) ${
                ((location.radius - 25) / 475) * 100
              }%,
              rgb(55, 65, 81) ${
                ((location.radius - 25) / 475) * 100
              }%,
              rgb(55, 65, 81) 100%
            )`,
          }}
        />

        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>25m</span>
          <span>250m</span>
          <span>500m</span>
        </div>

        <p className="text-sm text-gray-400 mt-2">
          Students must be within {location.radius} meters to mark
          attendance
        </p>
      </div>

      {/* Visual Indicator */}
      {hasLocation && (
        <div className="p-4 bg-blue-900/20 border border-blue-700 rounded-xl">
          <div className="flex items-start space-x-3">
            <MapPin
              className="text-blue-400 mt-1"
              size={20}
            />

            <div className="flex-1">
              <p className="font-medium text-blue-300">
                Geofencing Active
              </p>

              <p className="text-sm text-blue-400 mt-1">
                Students will need to be within {location.radius}m
                of the session location
                {location.room && ` (Room ${location.room}`}
                {location.building && `, ${location.building}`}
                {location.room && ')'}
              </p>

              {locationAccuracy && (
                <p className="text-sm text-blue-300 mt-2">
                  📍 Faculty GPS accuracy: ±
                  {Math.round(locationAccuracy)}m
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
