import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import axiosInstance from '../utils/axiosInstance';
import { Camera, CheckCircle, XCircle, MapPin, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { getDeviceInfo } from '../utils/deviceFingerprint';
import FaceVerification from '../components/FaceVerification';
import jsQR from 'jsqr';
import {
  VERIFICATION_STEP_DELAY,
  SUCCESS_MESSAGE_DELAY,
  REDIRECT_DELAY,
  QR_SCAN_INTERVAL,
  LOCATION_TIMEOUT,
  WEBSOCKET_RECONNECT_DELAY,
  getSocketURL,
} from '../lib/constants';

/**
 * Clean sequential verification flow — no stale-state race conditions.
 *
 * All step tracking uses refs so callbacks always see current values.
 *
 * Phases:
 *   ready      → show "Start" button
 *   scanning   → QR camera active
 *   face       → FaceVerification component visible
 *   face_failed→ face timed-out / failed, show retry
 *   location   → fetching GPS (spinner)
 *   location_failed → GPS denied / timed out, show retry
 *   submitting → POST /attendance/mark in progress
 *   done       → success, redirect pending
 *   error      → backend rejection, show message + try-again
 */
export default function ScanQR() {
  const navigate = useNavigate();

  // ── Camera / scanning refs ──────────────────────────────────
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanIntervalRef = useRef(null);
  const streamRef = useRef(null);

  // ── Step tracking — all in refs to avoid stale closures ────
  const attendanceMarkedRef = useRef(false);
  const stepsRef = useRef([]);         // remaining steps after QR: ['faceVerification', 'locationVerification']
  const stepIdxRef = useRef(0);        // index into stepsRef.current
  const resultsRef = useRef({});       // { qrCode, faceVerification, locationVerification }
  const requirementsRef = useRef({});  // full session.verificationRequirements

  // ── Render state ────────────────────────────────────────────
  const [phase, setPhase] = useState('ready');
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');

  // Progress bar display only (not used for logic)
  const [allSteps, setAllSteps] = useState([]);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);

  // ── Socket setup ────────────────────────────────────────────
  useEffect(() => {
    const authData = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    const userId = authData.state?.user?._id;
    const role = authData.state?.user?.role;
    if (!userId) return;

    const socket = io(getSocketURL(), { auth: { userId, role } });

    socket.on('attendance-confirmed', () => {
      if (!attendanceMarkedRef.current) {
        attendanceMarkedRef.current = true;
        setPhase('done');
        setMessage('✅ Attendance confirmed by server! Redirecting...');
        setMessageType('success');
        setTimeout(
          () => navigate('/student', { state: { refresh: true, attendanceMarked: true } }),
          WEBSOCKET_RECONNECT_DELAY
        );
      }
    });

    return () => socket.disconnect();
  }, [navigate]);

  // ── Camera cleanup on unmount ───────────────────────────────
  useEffect(() => () => stopCamera(), []);

  // ── Camera helpers ──────────────────────────────────────────
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      });
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setScanning(true);
      setMessage('📱 Scanning for QR code...');
      setMessageType('info');
      scanIntervalRef.current = setInterval(scanFrame, QR_SCAN_INTERVAL);
    } catch {
      setMessage('❌ Camera access denied. Please enable camera permissions in your browser settings.');
      setMessageType('error');
    }
  };

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const scanFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });
    if (code?.data) {
      stopCamera();
      handleQRDetected(code.data);
    }
  };

  // ── QR detected ─────────────────────────────────────────────
  const handleQRDetected = async (qrToken) => {
    setPhase('submitting'); // lock UI during fetch
    setMessage('✅ QR Code scanned! Verifying session...');
    setMessageType('success');

    try {
      const [encodedPayload] = qrToken.split('.');
      const payload = JSON.parse(atob(encodedPayload));
      const { data } = await axiosInstance.get(`/sessions/${payload.sid}`);
      const requirements = data.data.session.verificationRequirements || {};
      requirementsRef.current = requirements;

      // Store QR result
      resultsRef.current = { qrCode: { token: qrToken, verified: true } };

      // Build full step list for progress display
      const steps = [{ type: 'qrCode', name: 'QR Code', icon: '📱' }];
      if (requirements.faceVerification)
        steps.push({ type: 'faceVerification', name: 'Face Check', icon: '👤' });
      if (requirements.locationVerification)
        steps.push({ type: 'locationVerification', name: 'Location', icon: '📍' });

      setAllSteps(steps);
      setCompletedSteps(['qrCode']);
      setCurrentStepIdx(0);

      // Remaining steps (after QR)
      const remaining = [];
      if (requirements.faceVerification) remaining.push('faceVerification');
      if (requirements.locationVerification) remaining.push('locationVerification');

      stepsRef.current = remaining;
      stepIdxRef.current = 0;

      if (remaining.length === 0) {
        setMessage('✅ QR verified! Marking attendance...');
        setTimeout(() => submitAttendance(), REDIRECT_DELAY);
      } else {
        setMessage('✅ QR verified! Proceeding to next verification step...');
        setTimeout(() => runStep(0, remaining), VERIFICATION_STEP_DELAY);
      }
    } catch (err) {
      const status = err?.response?.status;
      const msg = status === 404
        ? '❌ Session not found. Ask your instructor to refresh the QR code.'
        : status === 400
        ? `❌ ${err.response.data?.message || 'Session is not active.'}`
        : '❌ Invalid or expired QR code. Please try again.';
      setMessage(msg);
      setMessageType('error');
      setPhase('scanning');
      startCamera();
    }
  };

  // ── Step runner ──────────────────────────────────────────────
  // idx: index into the `stepsArray` (remaining steps after QR)
  const runStep = (idx, stepsArray) => {
    if (idx >= stepsArray.length) {
      submitAttendance();
      return;
    }
    const stepType = stepsArray[idx];
    // +2 because QR was step 1 and allSteps includes QR at index 0
    setCurrentStepIdx(idx + 1);
    setMessage(`Step ${idx + 2}: ${stepType === 'faceVerification' ? '👤 Face Liveness Check' : '📍 Location Verification'}`);
    setMessageType('info');

    if (stepType === 'faceVerification') {
      setPhase('face');
    } else if (stepType === 'locationVerification') {
      setPhase('location');
      doLocationStep(idx, stepsArray);
    }
  };

  // ── Face step callbacks ──────────────────────────────────────
  const handleFaceVerified = (result) => {
    resultsRef.current.faceVerification = { verified: true, result };
    const idx = stepIdxRef.current;
    stepIdxRef.current = idx + 1;
    setCompletedSteps((prev) => [...prev, 'faceVerification']);
    setPhase('idle');
    setMessage('✅ Face verified! Proceeding...');
    setMessageType('success');
    setTimeout(() => runStep(idx + 1, stepsRef.current), VERIFICATION_STEP_DELAY);
  };

  const handleFaceFailed = () => {
    setPhase('face_failed');
    setMessage('❌ Face liveness check failed. Please retry.');
    setMessageType('error');
  };

  const retryFace = () => {
    setPhase('face');
    setMessage('👤 Retrying face liveness check...');
    setMessageType('info');
  };

  // ── Location step ────────────────────────────────────────────
  // Collect multiple readings instead of trusting a single GPS fix.
  // Temporary POSITION_UNAVAILABLE / TIMEOUT errors do not immediately
  // fail verification. We keep listening until the attempt finishes and
  // return the reading with the best reported accuracy.
  const getLocationData = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      const watchDuration = Math.max(15000, Number(LOCATION_TIMEOUT) || 0);
      const fallbackTimeout = 10000;

      let watchId = null;
      let finishTimer = null;
      let finished = false;
      let fallbackStarted = false;
      let bestPosition = null;

      const PERMISSION_DENIED = 1;
      const POSITION_UNAVAILABLE = 2;
      const TIMEOUT = 3;

      const cleanup = () => {
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }

        if (finishTimer !== null) {
          clearTimeout(finishTimer);
          finishTimer = null;
        }
      };

      const finishWithBest = () => {
        if (finished) return;

        finished = true;
        cleanup();

        if (!bestPosition) {
          reject(new Error('Location information unavailable'));
          return;
        }

        resolve({
          latitude: bestPosition.coords.latitude,
          longitude: bestPosition.coords.longitude,
          accuracy: bestPosition.coords.accuracy,
          timestamp: bestPosition.timestamp,
        });
      };

      const startFallback = () => {
        if (finished || fallbackStarted) return;

        if (bestPosition) {
          finishWithBest();
          return;
        }

        fallbackStarted = true;

        // Some mobile browsers can fail to obtain a high-accuracy fix
        // even though normal browser location is available. Try a normal
        // location request before giving up completely.
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (
              !bestPosition ||
              Number(position.coords.accuracy) <
                Number(bestPosition.coords.accuracy)
            ) {
              bestPosition = position;
            }
            finishWithBest();
          },
          () => {
            finishWithBest();
          },
          {
            enableHighAccuracy: false,
            timeout: fallbackTimeout,
            maximumAge: 0,
          }
        );
      };

      const handlePosition = (position) => {
        if (finished) return;

        const accuracy = Number(position.coords.accuracy);

        if (
          !bestPosition ||
          (Number.isFinite(accuracy) &&
            accuracy < Number(bestPosition.coords.accuracy))
        ) {
          bestPosition = position;

          setMessage(
            `📍 Improving location accuracy... Current: ±${Math.round(
              accuracy
            )}m`
          );
          setMessageType('info');

          // Stop early when the device reports a strong GPS fix.
          if (Number.isFinite(accuracy) && accuracy <= 20) {
            finishWithBest();
          }
        }
      };

      const handleError = (error) => {
        if (finished) return;

        // Permission denied is a definitive permission problem.
        if (error.code === PERMISSION_DENIED) {
          finished = true;
          cleanup();
          reject(new Error('Location permission denied'));
          return;
        }

        // POSITION_UNAVAILABLE can be temporary on mobile. Keep the
        // watcher alive so a later reading can still succeed.
        if (error.code === POSITION_UNAVAILABLE) {
          setMessage('📡 GPS is temporarily unavailable. Trying again...');
          setMessageType('info');
          return;
        }

        // For timeout, try the fallback location provider/request.
        if (error.code === TIMEOUT) {
          setMessage(
            '📡 GPS is taking longer than expected. Trying another location method...'
          );
          setMessageType('info');
          startFallback();
        }
      };

      setMessage('📍 Getting your most accurate location...');
      setMessageType('info');

      watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handleError,
        {
          enableHighAccuracy: true,
          timeout: watchDuration,
          maximumAge: 0,
        }
      );

      // Give high-accuracy location time to settle. If no fix arrives,
      // use the fallback request rather than failing immediately.
      finishTimer = setTimeout(() => {
        if (bestPosition) {
          finishWithBest();
        } else {
          startFallback();
        }
      }, watchDuration);
    });

  const doLocationStep = async (idx, stepsArray) => {
    try {
      const loc = await getLocationData();

      resultsRef.current.locationVerification = {
        verified: true,
        location: loc,
      };

      const nextIdx = idx + 1;
      stepIdxRef.current = nextIdx;

      setCompletedSteps((prev) => [
        ...prev,
        'locationVerification',
      ]);

      setMessage(
        `✅ Location acquired! GPS accuracy: ±${Math.round(
          loc.accuracy
        )}m`
      );
      setMessageType('success');

      setTimeout(
        () => runStep(nextIdx, stepsArray),
        VERIFICATION_STEP_DELAY
      );
    } catch (error) {
      // Don't advance stepIdx on failure so retry re-runs the same step.
      setPhase('location_failed');

      if (error?.message === 'Location permission denied') {
        setMessage(
          '❌ Location permission denied. Please allow location access in your browser settings and retry.'
        );
      } else {
        setMessage(
          '❌ Could not obtain your location. Please make sure phone Location is ON and retry.'
        );
      }

      setMessageType('error');
    }
  };

  const retryLocation = () => {
    setPhase('location');
    setMessage('📍 Retrying location...');
    setMessageType('info');
    doLocationStep(stepIdxRef.current, stepsRef.current);
  };

  // ── Submit attendance ────────────────────────────────────────
  const submitAttendance = async () => {
    if (attendanceMarkedRef.current) return;
    attendanceMarkedRef.current = true;
    setPhase('submitting');
    setMessage('⚡ All verifications complete! Marking attendance...');
    setMessageType('info');

    try {
      const r = resultsRef.current;
      const deviceInfo = getDeviceInfo();

      const { data } = await axiosInstance.post('/attendance/mark', {
        qrToken: r.qrCode?.token,
        location: r.locationVerification?.location || null,
        faceVerificationPassed: !!r.faceVerification?.verified,
        deviceInfo,
      });

      setPhase('done');
      setCompletedSteps(allSteps.map((s) => s.type));
      setMessage(
        `🎉 Attendance Marked!\n📚 ${data.data.sessionTitle}\n🏫 ${data.data.className}\n👤 ${data.data.studentName}\n📍 GPS Accuracy: ±${Math.round(r.locationVerification?.location?.accuracy || 0)}m`
      );
      setMessageType('success');

      setTimeout(
        () => navigate('/student', { state: { refresh: true, attendanceMarked: true } }),
        SUCCESS_MESSAGE_DELAY
      );
    } catch (err) {
      attendanceMarkedRef.current = false;
      setPhase('error');
      const errData = err.response?.data;

      if (errData?.errorType === 'PROXY_DETECTION') {
        setMessage(
          `🚫 Proxy Attendance Blocked!\n${errData.message}\n📱 Device: ${errData.details?.deviceId}\n👤 Previous: ${errData.details?.previousStudent}`
        );
      } else if (errData?.requiresLocation) {
        setMessage('❌ Location verification is required for this session. Please enable location access.');
      } else {
        setMessage(`❌ ${errData?.message || 'Failed to mark attendance. Please try again.'}`);
      }
      setMessageType('error');
    }
  };

  // ── Start verification ───────────────────────────────────────
  const startVerification = () => {
    setPhase('scanning');
    setMessage('📱 Point your camera at the QR code shown by your instructor');
    setMessageType('info');
    startCamera();
  };

  // ── Reset everything ─────────────────────────────────────────
  const resetAll = () => {
    attendanceMarkedRef.current = false;
    stepsRef.current = [];
    stepIdxRef.current = 0;
    resultsRef.current = {};
    requirementsRef.current = {};
    setAllSteps([]);
    setCompletedSteps([]);
    setCurrentStepIdx(0);
    setPhase('ready');
    setMessage('');
    setMessageType('info');
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="max-w-2xl mx-auto">

            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Mark Attendance
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
                Complete all required verification steps in order
              </p>
            </div>

            {/* ── Progress bar ── */}
            {allSteps.length > 0 && (
              <div className="card-elevated p-4 mb-4">
                <div className="flex items-start">
                  {allSteps.map((step, i) => (
                    <div key={step.type} className="flex items-center flex-1">
                      <div className="flex flex-col items-center flex-1">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                            completedSteps.includes(step.type)
                              ? 'bg-green-500 text-white'
                              : i === currentStepIdx
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                          }`}
                        >
                          {completedSteps.includes(step.type) ? '✓' : i + 1}
                        </div>
                        <span
                          className={`mt-1 text-xs text-center leading-tight ${
                            completedSteps.includes(step.type)
                              ? 'text-green-600 font-semibold'
                              : i === currentStepIdx
                              ? 'text-blue-600 font-semibold'
                              : 'text-gray-400'
                          }`}
                        >
                          {step.icon} {step.name}
                        </span>
                      </div>
                      {i < allSteps.length - 1 && (
                        <div
                          className={`h-0.5 flex-1 mx-1 mt-[-18px] transition-colors ${
                            completedSteps.includes(step.type) ? 'bg-green-400' : 'bg-gray-200 dark:bg-gray-700'
                          }`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Status message ── */}
            {message && (
              <div
                className={`mb-4 p-3 sm:p-4 rounded-lg flex items-start gap-2 ${
                  messageType === 'success'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                    : messageType === 'error'
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400'
                }`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {messageType === 'success' ? (
                    <CheckCircle size={18} />
                  ) : messageType === 'error' ? (
                    <XCircle size={18} />
                  ) : (
                    <AlertTriangle size={18} />
                  )}
                </div>
                <span className="whitespace-pre-line text-sm leading-relaxed">{message}</span>
              </div>
            )}

            {/* ── PHASE: ready ── */}
            {phase === 'ready' && (
              <div className="card-elevated p-6 text-center">
                <ShieldCheck size={56} className="text-indigo-500 mx-auto mb-4" />
                <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-2">
                  Ready to Mark Attendance?
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                  Scan the QR code displayed by your instructor to begin.
                </p>
                <button
                  onClick={startVerification}
                  className="btn-primary inline-flex items-center gap-2 py-3 px-8 text-base mx-auto"
                >
                  <ShieldCheck size={20} /> Start Verification
                </button>
              </div>
            )}

            {/* ── PHASE: scanning ── */}
            {phase === 'scanning' && (
              <div className="card-elevated p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center">
                    <Camera size={16} className="text-white" />
                  </div>
                  <h2 className="font-bold text-gray-900 dark:text-white">QR Code Scanner</h2>
                </div>

                <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden mb-3 relative">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  <canvas ref={canvasRef} className="absolute inset-0 opacity-0" />

                  {scanning && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-52 h-52 border-4 border-green-400 rounded-lg relative">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-green-400" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-green-400" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-green-400" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-green-400" />
                      </div>
                    </div>
                  )}

                  {!scanning && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <div className="text-center">
                        <Camera size={40} className="text-white mx-auto mb-2" />
                        <p className="text-white text-sm">Tap Start Camera</p>
                      </div>
                    </div>
                  )}
                </div>

                {!scanning ? (
                  <button
                    onClick={startCamera}
                    className="btn-primary w-full flex items-center justify-center gap-2 py-3"
                  >
                    <Camera size={18} /> Start Camera
                  </button>
                ) : (
                  <button
                    onClick={stopCamera}
                    className="btn-danger w-full py-3"
                  >
                    Stop Camera
                  </button>
                )}

                <p className="text-xs text-center text-gray-400 mt-3">
                  Hold steady and point at the QR code on the instructor's screen
                </p>
              </div>
            )}

            {/* ── PHASE: face ── */}
            {phase === 'face' && (
              <div className="card-elevated p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-500 flex items-center justify-center">
                    <ShieldCheck size={16} className="text-white" />
                  </div>
                  <h2 className="font-bold text-gray-900 dark:text-white">Face Liveness Check</h2>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  Look at the camera and move your head slightly to confirm you are a real person.
                </p>
                <FaceVerification
                  autoStart={true}
                  onVerified={handleFaceVerified}
                  onFailed={handleFaceFailed}
                />
              </div>
            )}

            {/* ── PHASE: face_failed ── */}
            {phase === 'face_failed' && (
              <div className="card-elevated p-6 mb-4 text-center">
                <XCircle size={52} className="text-red-500 mx-auto mb-3" />
                <p className="font-semibold text-gray-900 dark:text-white mb-1">
                  Face liveness check failed
                </p>
                <p className="text-sm text-gray-500 mb-5">
                  No face was detected within the time limit. Please try again.
                </p>
                <button onClick={retryFace} className="btn-primary w-full py-3">
                  <RefreshCw size={18} className="inline mr-2" /> Retry Face Check
                </button>
              </div>
            )}

            {/* ── PHASE: location ── */}
            {phase === 'location' && (
              <div className="card-elevated p-6 mb-4 text-center">
                <MapPin size={52} className="text-green-500 mx-auto mb-3 animate-bounce" />
                <p className="font-semibold text-gray-900 dark:text-white">Getting your location...</p>
                <p className="text-sm text-gray-500 mt-1">Please allow location access in your browser</p>
              </div>
            )}

            {/* ── PHASE: location_failed ── */}
            {phase === 'location_failed' && (
              <div className="card-elevated p-6 mb-4 text-center">
                <XCircle size={52} className="text-red-500 mx-auto mb-3" />
                <p className="font-semibold text-gray-900 dark:text-white mb-1">
                  Location access failed
                </p>
                <p className="text-sm text-gray-500 mb-5">
                  Please enable location permissions in your browser settings and retry.
                </p>
                <button onClick={retryLocation} className="btn-primary w-full py-3">
                  <RefreshCw size={18} className="inline mr-2" /> Retry Location
                </button>
              </div>
            )}

            {/* ── PHASE: submitting ── */}
            {phase === 'submitting' && (
              <div className="card-elevated p-6 mb-4 text-center">
                <div className="animate-spin rounded-full h-14 w-14 border-b-2 border-indigo-500 mx-auto mb-4" />
                <p className="font-semibold text-gray-900 dark:text-white">Processing...</p>
                <p className="text-sm text-gray-400 mt-1">Marking your attendance</p>
              </div>
            )}

            {/* ── PHASE: done ── */}
            {phase === 'done' && (
              <div className="card-elevated p-6 mb-4 text-center">
                <CheckCircle size={64} className="text-green-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  Attendance Marked!
                </h2>
                <p className="text-gray-500 text-sm">Redirecting to dashboard...</p>
              </div>
            )}

            {/* ── PHASE: error ── */}
            {phase === 'error' && (
              <div className="card-elevated p-6 mb-4 text-center">
                <button
                  onClick={resetAll}
                  className="btn-primary w-full py-3 mt-2 flex items-center justify-center gap-2"
                >
                  <RefreshCw size={18} /> Try Again
                </button>
              </div>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}
