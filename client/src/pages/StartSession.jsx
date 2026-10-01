import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import QRDisplay from '../components/QRDisplay';
import Loader from '../components/Loader';
import axiosInstance, { clearCache } from '../utils/axiosInstance';
import { Users, Clock, StopCircle, Settings, CheckCircle, XCircle, QrCode, Zap, Lock, MapPin, Pause, Play, Download, Send, List, Bell } from 'lucide-react';
import { getSocketURL } from '../lib/constants';

export default function StartSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [qrToken, setQrToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [qrEnabled, setQrEnabled] = useState(false);
  const [sessionDuration, setSessionDuration] = useState('0m');
  const [recentAttendance, setRecentAttendance] = useState([]);
  const [attendanceList, setAttendanceList] = useState([]);
  const [attendanceListLoading, setAttendanceListLoading] = useState(false);
  const [showAttendanceList, setShowAttendanceList] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [verificationSettings, setVerificationSettings] = useState({
    qrCode: true,
    faceVerification: false,
    locationVerification: false,
    facialRecognition: false, // Future
    fingerprintVerification: false, // Future
  });
  
  useEffect(() => {
    fetchSession();
    fetchAttendanceList();
    
    // Set up periodic refresh of attendance list when session is live
    let refreshInterval;
    if (session?.status === 'LIVE') {
      refreshInterval = setInterval(() => {
        fetchAttendanceList();
      }, 30000); // Refresh every 30 seconds
    }
    
    // Get auth data for WebSocket authentication
    const authData = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    const userId = authData.state?.user?._id;
    const role = authData.state?.user?.role;
    
    const newSocket = io(getSocketURL(), { auth: { userId, role } });
    
    // Monitor WebSocket connection status
    newSocket.on('connect', () => {
      console.log('✅ WebSocket connected');
      setSocketConnected(true);
    });
    
    newSocket.on('disconnect', () => {
      console.log('❌ WebSocket disconnected');
      setSocketConnected(false);
    });
    
    setSocket(newSocket);
    
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      if (newSocket) {
        newSocket.emit('leave-session', id);
        newSocket.disconnect();
      }
    };
  }, [id, session?.status]);
  
  // Session duration timer
  useEffect(() => {
    if (!session?.startTime) return;
    
    const updateDuration = () => {
      const start = new Date(session.startTime);
      const now = new Date();
      const diffMs = now - start;
      const diffMins = Math.floor(diffMs / 60000);
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      
      if (hours > 0) {
        setSessionDuration(`${hours}h ${mins}m`);
      } else {
        setSessionDuration(`${mins}m`);
      }
    };
    
    updateDuration();
    const interval = setInterval(updateDuration, 60000); // Update every minute
    
    return () => clearInterval(interval);
  }, [session?.startTime]);
  
  useEffect(() => {
    if (!socket || session?.status !== 'LIVE') return;

    socket.emit('join-session', id);
    if (session.class?._id) socket.emit('join-class', session.class._id);

    // Named handlers so .off() removes exactly these functions
    const onQrUpdate = (data) => setQrToken(data.qrToken);

    const onAttendanceMarked = (data) => {
      // Use the count from the socket event directly — never re-fetch for count
      // to avoid the Axios cache returning stale attendanceCount: 0
      setSession((prev) => ({
        ...prev,
        attendanceCount: data.attendanceCount ?? (prev.attendanceCount + 1),
        totalStudents: data.totalStudents ?? prev.totalStudents,
      }));
      if (data.studentName || data.student) {
        setRecentAttendance((prev) =>
          [
            {
              studentName: data.student?.name || data.studentName || 'Student',
              studentId: data.student?.studentId || data.studentId || 'N/A',
              timestamp: new Date(),
              status: 'success',
            },
            ...prev,
          ].slice(0, 10)
        );
      }
      // Clear cache so the attendance list reflects the new record
      clearCache();
      fetchAttendanceList();
    };

    const onClassAttendanceUpdate = (data) => {
      // Update count directly from event data — do NOT call fetchSession() here
      // because the Axios cache would overwrite the live count with stale data
      if (data.attendanceCount !== undefined) {
        setSession((prev) => ({ ...prev, attendanceCount: data.attendanceCount }));
      }
      if (data.studentName || data.studentId) {
        setRecentAttendance((prev) =>
          [
            {
              studentName: data.studentName || 'Student',
              studentId: data.studentId || 'N/A',
              timestamp: new Date(),
              status: 'success',
            },
            ...prev,
          ].slice(0, 10)
        );
      }
      // Only refresh the attendance list (not session) — clear cache first
      clearCache();
      fetchAttendanceList();
    };

    const onVerificationSettingsUpdated = (data) =>
      setVerificationSettings(data.verificationRequirements);

    const onSessionStatusChanged = (data) =>
      setSession((prev) => ({ ...prev, status: data.status }));

    socket.on('qr-update', onQrUpdate);
    socket.on('attendance-marked', onAttendanceMarked);
    socket.on('class-attendance-update', onClassAttendanceUpdate);
    socket.on('verification-settings-updated', onVerificationSettingsUpdated);
    socket.on('session-status-changed', onSessionStatusChanged);

    return () => {
      socket.emit('leave-session', id);
      socket.off('qr-update', onQrUpdate);
      socket.off('attendance-marked', onAttendanceMarked);
      socket.off('class-attendance-update', onClassAttendanceUpdate);
      socket.off('verification-settings-updated', onVerificationSettingsUpdated);
      socket.off('session-status-changed', onSessionStatusChanged);
    };
  }, [socket, session?.status, session?.class?._id, id]);
  
  const fetchSession = async () => {
    try {
      // Always bypass cache for live session data so counts are never stale
      clearCache();
      const { data } = await axiosInstance.get(`/sessions/${id}`);
      console.log('📊 Session data fetched:', data.data.session);
      console.log('📊 Attendance count:', data.data.session.attendanceCount);
      console.log('📊 Total students:', data.data.session.totalStudents);
      
      setSession(data.data.session);
      setQrEnabled(data.data.session.qrEnabled || false);
      
      // Set verification settings from session
      if (data.data.session.verificationRequirements) {
        setVerificationSettings(data.data.session.verificationRequirements);
      }
      
      if (data.data.session.status !== 'LIVE') {
        try {
          await axiosInstance.post(`/sessions/${id}/start`);
          const updated = await axiosInstance.get(`/sessions/${id}`);
          setSession(updated.data.data.session);
          setQrEnabled(updated.data.data.session.qrEnabled || false);
          if (updated.data.data.session.verificationRequirements) {
            setVerificationSettings(updated.data.data.session.verificationRequirements);
          }
          
          // If QR is enabled, fetch the QR token
          if (updated.data.data.session.qrEnabled) {
            const qrData = await axiosInstance.get(`/sessions/${id}/qr`);
            setQrToken(qrData.data.data.qrToken);
          }
        } catch (startError) {
          // If session is already live, just continue
          if (startError.response?.status === 400) {
            console.log('Session already live, continuing...');
            // Still fetch QR if enabled
            if (data.data.session.qrEnabled) {
              const qrData = await axiosInstance.get(`/sessions/${id}/qr`);
              setQrToken(qrData.data.data.qrToken);
            }
          } else {
            throw startError;
          }
        }
      } else {
        // Session is already live, fetch QR if enabled
        if (data.data.session.qrEnabled) {
          const qrData = await axiosInstance.get(`/sessions/${id}/qr`);
          setQrToken(qrData.data.data.qrToken);
        }
      }
    } catch (error) {
      console.error('Error fetching session:', error);
      if (error.response?.status === 404) {
        alert('Session not found. Redirecting to dashboard...');
        navigate('/faculty');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchAttendanceList = async () => {
    try {
      setAttendanceListLoading(true);
      // No cache — this is a live feed that must always reflect new records
      clearCache();
      const { data } = await axiosInstance.get(`/sessions/${id}/attendance-public`);
      setAttendanceList(data.data.attendance || []);
    } catch (error) {
      console.error('Error fetching attendance list:', error);
      console.error('Error details:', error.response?.data);
      console.error('Error status:', error.response?.status);
      // Set empty array on error to prevent infinite loading
      setAttendanceList([]);
    } finally {
      setAttendanceListLoading(false);
    }
  };

  const handleDownloadAttendance = async () => {
    try {
      const { data } = await axiosInstance.get(`/sessions/${id}/attendance-public`);
      const attendance = data.data.attendance || [];
      
      // Create CSV content
      const csvHeader = 'Student Name,Student ID,Email,Marked At,Status\n';
      const csvRows = attendance.map(a => 
        `"${a.student?.name || 'N/A'}","${a.student?.studentId || 'N/A'}","${a.student?.email || 'N/A'}","${new Date(a.markedAt).toLocaleString()}","${a.status || 'PRESENT'}"`
      ).join('\n');
      
      const csvContent = csvHeader + csvRows;
      
      // Create download link
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `attendance_${session?.title}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading attendance:', error);
      alert('Failed to download attendance');
    }
  };

  const handleSendReminder = async () => {
    try {
      // TODO: Implement backend endpoint for sending reminders
      alert('Reminder feature coming soon! This will send notifications to absent students.');
    } catch (error) {
      console.error('Error sending reminder:', error);
      alert('Failed to send reminder');
    }
  };

  const toggleQR = async () => {
    try {
      const newQrState = !qrEnabled;
      await axiosInstance.patch(`/sessions/${id}/toggle-qr`, {
        qrEnabled: newQrState
      });
      setQrEnabled(newQrState);
      // Sync local verificationSettings so the status card & settings panel stay consistent
      setVerificationSettings(prev => ({ ...prev, qrCode: newQrState }));
      if (newQrState) {
        const { data } = await axiosInstance.get(`/sessions/${id}/qr`);
        setQrToken(data.data.qrToken);
      } else {
        setQrToken('');
      }
    } catch (error) {
      console.error('Error toggling QR:', error);
      alert('Failed to toggle QR code');
    }
  };

  const updateVerificationSettings = async (newSettings) => {
    try {
      await axiosInstance.patch(`/sessions/${id}/verification-settings`, {
        verificationRequirements: newSettings
      });
      setVerificationSettings(newSettings);
      // Sync qrEnabled toggle if qrCode requirement changed
      if (typeof newSettings.qrCode === 'boolean') {
        setQrEnabled(newSettings.qrCode);
        if (!newSettings.qrCode) setQrToken('');
      }
      alert('Verification settings updated successfully!');
    } catch (error) {
      console.error('Error updating settings:', error);
      alert('Failed to update settings');
    }
  };

  const handlePauseSession = async () => {
    try {
      await axiosInstance.post(`/sessions/${id}/pause`);
      setSession(prev => ({ ...prev, status: 'PAUSED' }));
    } catch (error) {
      console.error('Error pausing session:', error);
      alert('Failed to pause session');
    }
  };

  const handleResumeSession = async () => {
    try {
      await axiosInstance.post(`/sessions/${id}/resume`);
      setSession(prev => ({ ...prev, status: 'LIVE' }));
    } catch (error) {
      console.error('Error resuming session:', error);
      alert('Failed to resume session');
    }
  };

  const handleEndSession = async () => {
    try {
      await axiosInstance.post(`/sessions/${id}/end`);
      navigate('/faculty');
    } catch (error) {
      console.error('Error ending session:', error);
    }
  };
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader size="lg" />
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
              <div>
                <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-2">
                  {session?.title}
                </h1>
                <p className="text-gray-400 flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  {session?.class?.name}
                </p>
              </div>
              <div className="flex gap-3">
                {session?.status === 'LIVE' && (
                  <button
                    onClick={handlePauseSession}
                    className="flex items-center space-x-2 px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-xl transition-all font-semibold"
                  >
                    <Pause size={20} />
                    <span>Pause Session</span>
                  </button>
                )}
                {session?.status === 'PAUSED' && (
                  <button
                    onClick={handleResumeSession}
                    className="flex items-center space-x-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl transition-all font-semibold"
                  >
                    <Play size={20} />
                    <span>Resume Session</span>
                  </button>
                )}
                <button
                  onClick={handleEndSession}
                  className="flex items-center space-x-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-all font-semibold"
                >
                  <StopCircle size={20} />
                  <span>End Session</span>
                </button>
              </div>
            </div>
            
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Attendance Card */}
              <div className="bg-[#1a1f35] border border-gray-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center">
                      <Users className="text-white" size={24} />
                    </div>
                    <h3 className="text-lg font-semibold text-white">Attendance</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* WebSocket Status Indicator */}
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                      socketConnected 
                        ? 'bg-green-900/30 text-green-400' 
                        : 'bg-red-900/30 text-red-400'
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        socketConnected ? 'bg-green-400' : 'bg-red-400'
                      }`}></div>
                      {socketConnected ? 'Live' : 'Offline'}
                    </div>
                    {/* Manual Refresh Button */}
                    <button
                      onClick={() => {
                        fetchSession();
                        fetchAttendanceList();
                      }}
                      className="p-1 text-gray-400 hover:text-white transition-colors"
                      title="Refresh attendance data"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-2">
                  {session?.attendanceCount || 0} / {session?.totalStudents || 0}
                </div>
                <p className="text-gray-400 text-sm">
                  {session?.totalStudents > 0
                    ? `${((session.attendanceCount / session.totalStudents) * 100).toFixed(1)}% present`
                    : '0.0% present'}
                </p>
              </div>
              
              {/* Session Time Card */}
              <div className="bg-[#1a1f35] border border-gray-800 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center">
                    <Clock className="text-white" size={24} />
                  </div>
                  <h3 className="text-lg font-semibold text-white">Session Time</h3>
                </div>
                <div className="text-xl font-semibold text-white mb-2">
                  Duration: {sessionDuration}
                </div>
                <p className="text-sm text-gray-400 mb-3">
                  Started: {session?.startTime ? new Date(session.startTime).toLocaleTimeString() : 'N/A'}
                </p>
                {session?.status === 'LIVE' && (
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-600/20 border border-red-600 rounded-full">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                    <span className="text-red-400 text-sm font-semibold">LIVE</span>
                  </div>
                )}
                {session?.status === 'PAUSED' && (
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-600/20 border border-yellow-600 rounded-full">
                    <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                    <span className="text-yellow-400 text-sm font-semibold">PAUSED</span>
                  </div>
                )}
              </div>
              
              {/* Verification Status Card */}
              <div className="bg-[#1a1f35] border border-gray-800 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center">
                    <Settings className="text-white" size={24} />
                  </div>
                  <h3 className="text-lg font-semibold text-white">Verification</h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {verificationSettings.qrCode ? (
                      <CheckCircle className="text-green-500" size={16} />
                    ) : (
                      <XCircle className="text-gray-500" size={16} />
                    )}
                    <span className={`text-sm ${verificationSettings.qrCode ? 'text-gray-300' : 'text-gray-500'}`}>
                      QR Code {!verificationSettings.qrCode && '(disabled)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {verificationSettings.faceVerification ? (
                      <CheckCircle className="text-green-500" size={16} />
                    ) : (
                      <XCircle className="text-gray-500" size={16} />
                    )}
                    <span className={`text-sm ${verificationSettings.faceVerification ? 'text-gray-300' : 'text-gray-500'}`}>
                      Face Liveness {!verificationSettings.faceVerification && '(off)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {verificationSettings.locationVerification ? (
                      <CheckCircle className="text-green-500" size={16} />
                    ) : (
                      <XCircle className="text-gray-500" size={16} />
                    )}
                    <span className={`text-sm ${verificationSettings.locationVerification ? 'text-gray-300' : 'text-gray-500'}`}>
                      GPS Location {!verificationSettings.locationVerification && '(off)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="text-blue-500" size={16} />
                    <span className="text-sm text-gray-300">Background Checks</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Quick Actions Bar */}
            <div className="bg-[#1a1f35] border border-gray-800 rounded-2xl p-4 mb-8">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleDownloadAttendance}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all font-semibold"
                >
                  <Download size={18} />
                  <span>Download Attendance</span>
                </button>
                <button
                  onClick={handleSendReminder}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-all font-semibold"
                >
                  <Send size={18} />
                  <span>Send Reminder to Absent</span>
                </button>
                <button
                  onClick={() => setShowAttendanceList(!showAttendanceList)}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-all font-semibold"
                >
                  <List size={18} />
                  <span>{showAttendanceList ? 'Hide' : 'View'} Attendance List</span>
                </button>
                {/* WebSocket Test Button (Development) */}
                <button
                  onClick={() => {
                    console.log('🧪 Testing WebSocket connection...');
                    console.log('Socket connected:', socketConnected);
                    console.log('Socket instance:', socket);
                    if (socket) {
                      socket.emit('ping');
                      console.log('Ping sent to server');
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-all font-semibold"
                  title="Test WebSocket connection"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Test WS</span>
                </button>
              </div>
            </div>
            
            {/* Real-Time Attendance Feed */}
            {recentAttendance.length > 0 && (
              <div className="bg-[#1a1f35] border border-gray-800 rounded-2xl p-6 mb-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                    <Bell className="text-white" size={20} />
                  </div>
                  <h3 className="text-lg font-bold text-white">Recent Attendance</h3>
                  <span className="ml-auto text-xs text-gray-400">Live Updates</span>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {recentAttendance.map((entry, index) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between p-3 bg-green-900/20 border border-green-700 rounded-lg animate-fade-in"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                          <CheckCircle className="text-white" size={16} />
                        </div>
                        <div>
                          <p className="font-semibold text-white">{entry.studentName}</p>
                          <p className="text-xs text-gray-400">{entry.studentId}</p>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Full Attendance List Modal */}
            {showAttendanceList && (
              <div className="bg-[#1a1f35] border border-gray-800 rounded-2xl p-6 mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-white">Full Attendance List</h3>
                  <button
                    onClick={() => setShowAttendanceList(false)}
                    className="text-gray-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="text-left py-3 px-4 text-gray-400 font-semibold">#</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-semibold">Student Name</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-semibold">Student ID</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-semibold">Time</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendanceListLoading ? (
                        <tr>
                          <td colSpan="5" className="py-8 text-center text-gray-400">
                            <div className="flex items-center justify-center space-x-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                              <span>Loading attendance records...</span>
                            </div>
                          </td>
                        </tr>
                      ) : attendanceList.length > 0 ? (
                        attendanceList.map((record, index) => (
                          <tr key={record._id} className="border-b border-gray-800 hover:bg-gray-800/50">
                            <td className="py-3 px-4 text-gray-300">{index + 1}</td>
                            <td className="py-3 px-4 text-white font-semibold">{record.student?.name || 'N/A'}</td>
                            <td className="py-3 px-4 text-gray-300">{record.student?.studentId || 'N/A'}</td>
                            <td className="py-3 px-4 text-gray-400 text-sm">
                              {new Date(record.markedAt).toLocaleTimeString()}
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-1 bg-green-900/30 text-green-400 rounded text-xs font-semibold">
                                {record.status || 'PRESENT'}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" className="py-8 text-center text-gray-400">
                            No attendance records yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {/* QR Code & Verification Panel */}
            <div className="bg-[#1a1f35] border border-gray-800 rounded-2xl p-6 mb-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center">
                    <QrCode className="text-white" size={24} />
                  </div>
                  <h3 className="text-xl font-bold text-white">QR Code & Verification</h3>
                </div>
                <button
                  onClick={toggleQR}
                  className={`px-6 py-3 rounded-xl font-bold transition-all ${
                    qrEnabled
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  }`}
                >
                  {qrEnabled ? '✓ QR Enabled' : 'Enable QR Code'}
                </button>
              </div>
              
              {/* Verification Requirements */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
                      <Settings className="text-white" size={20} />
                    </div>
                    <h4 className="font-bold text-white">Verification Requirements</h4>
                  </div>
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 rounded-lg transition-all text-sm font-semibold"
                  >
                    {showSettings ? '✓ Hide Settings' : '⚙️ Configure'}
                  </button>
                </div>
                
                {/* Verification Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  {/* QR Code */}
                  <div className={`p-4 rounded-xl border-2 ${
                    verificationSettings.qrCode
                      ? 'bg-green-600/10 border-green-600'
                      : 'bg-gray-800/50 border-gray-700'
                  }`}>
                    <div className="flex items-center gap-3">
                      {verificationSettings.qrCode ? (
                        <CheckCircle className="text-green-500" size={20} />
                      ) : (
                        <XCircle className="text-gray-500" size={20} />
                      )}
                      <div>
                        <div className="font-semibold text-white">QR Code</div>
                        <div className="text-xs text-gray-400">
                          {verificationSettings.qrCode ? 'Required' : 'Disabled (auto-attendance)'}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Face Liveness */}
                  <div className={`p-4 rounded-xl border-2 ${
                    verificationSettings.faceVerification 
                      ? 'bg-green-600/10 border-green-600' 
                      : 'bg-gray-800/50 border-gray-700'
                  }`}>
                    <div className="flex items-center gap-3">
                      {verificationSettings.faceVerification ? (
                        <CheckCircle className="text-green-500" size={20} />
                      ) : (
                        <XCircle className="text-gray-500" size={20} />
                      )}
                      <div>
                        <div className="font-semibold text-white">Face Liveness</div>
                        <div className="text-xs text-gray-400">
                          {verificationSettings.faceVerification ? 'Required' : 'Optional'}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* GPS Location */}
                  <div className={`p-4 rounded-xl border-2 ${
                    verificationSettings.locationVerification 
                      ? 'bg-green-600/10 border-green-600' 
                      : 'bg-gray-800/50 border-gray-700'
                  }`}>
                    <div className="flex items-center gap-3">
                      {verificationSettings.locationVerification ? (
                        <CheckCircle className="text-green-500" size={20} />
                      ) : (
                        <XCircle className="text-gray-500" size={20} />
                      )}
                      <div>
                        <div className="font-semibold text-white">GPS Location</div>
                        <div className="text-xs text-gray-400">
                          {verificationSettings.locationVerification ? 'Required' : 'Optional'}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Face Recognition - Coming Soon */}
                  <div className="p-4 rounded-xl border-2 bg-amber-900/10 border-amber-700 opacity-60">
                    <div className="flex items-center gap-3">
                      <Lock className="text-amber-500" size={20} />
                      <div>
                        <div className="font-semibold text-white">Face Recognition</div>
                        <div className="text-xs text-amber-400 font-semibold">Coming Soon</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Fingerprint - Coming Soon */}
                  <div className="p-4 rounded-xl border-2 bg-amber-900/10 border-amber-700 opacity-60">
                    <div className="flex items-center gap-3">
                      <Lock className="text-amber-500" size={20} />
                      <div>
                        <div className="font-semibold text-white">Fingerprint</div>
                        <div className="text-xs text-amber-400 font-semibold">Coming Soon</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Background Checks */}
                  <div className="p-4 rounded-xl border-2 bg-blue-900/10 border-blue-700">
                    <div className="flex items-center gap-3">
                      <Zap className="text-blue-500" size={20} />
                      <div>
                        <div className="font-semibold text-white text-sm">Background Checks</div>
                        <div className="text-xs text-blue-400">Always Active</div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Future Features Notice */}
                <div className="p-4 bg-amber-900/20 border border-amber-700 rounded-xl">
                  <p className="text-xs text-amber-400">
                    <strong>📌 Note:</strong> Face Recognition and Fingerprint verification require biometric enrollment data in the database. These features will be available once student biometric data is collected and stored securely.
                  </p>
                </div>
                
                {/* Settings Panel */}
                {showSettings && (
                  <div className="mt-6 p-6 bg-indigo-900/20 border-2 border-indigo-700 rounded-xl">
                    <h4 className="font-bold text-lg mb-4 text-white">⚙️ Configure Active Verification Methods</h4>
                    <div className="space-y-4">
                      <label className="flex items-center justify-between p-4 rounded-lg bg-gray-800/50 hover:bg-gray-800 cursor-pointer transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">📱</span>
                          <div>
                            <span className="font-semibold text-white block">Require QR Code Scan</span>
                            <span className="text-xs text-gray-400">Students must scan the QR code. Disable for auto (location-only) attendance.</span>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={verificationSettings.qrCode}
                          onChange={(e) => {
                            const newSettings = { ...verificationSettings, qrCode: e.target.checked };
                            updateVerificationSettings(newSettings);
                          }}
                          className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                        />
                      </label>

                      <label className="flex items-center justify-between p-4 rounded-lg bg-gray-800/50 hover:bg-gray-800 cursor-pointer transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">👤</span>
                          <div>
                            <span className="font-semibold text-white block">Require Face Liveness Detection</span>
                            <span className="text-xs text-gray-400">Real-time movement check (not facial recognition)</span>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={verificationSettings.faceVerification}
                          onChange={(e) => {
                            const newSettings = { ...verificationSettings, faceVerification: e.target.checked };
                            updateVerificationSettings(newSettings);
                          }}
                          className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                        />
                      </label>

                      <label className="flex items-center justify-between p-4 rounded-lg bg-gray-800/50 hover:bg-gray-800 cursor-pointer transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">📍</span>
                          <div>
                            <span className="font-semibold text-white block">Require GPS Location Verification</span>
                            <span className="text-xs text-gray-400">Geofencing — students must be physically present</span>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={verificationSettings.locationVerification}
                          onChange={(e) => {
                            const newSettings = { ...verificationSettings, locationVerification: e.target.checked };
                            updateVerificationSettings(newSettings);
                          }}
                          className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                        />
                      </label>
                    </div>
                    <p className="text-xs text-gray-400 mt-4 p-3 bg-gray-800/50 rounded-lg">
                      💡 Students complete all enabled steps in order: QR → Face → Location. Disable QR to enable auto (location-only) attendance. Background security checks run automatically.
                    </p>
                  </div>
                )}
              </div>
            </div>
            
            {/* QR Code Display */}
            <div className="bg-[#1a1f35] border border-gray-800 rounded-2xl p-8">
              <h2 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-8">
                Attendance QR Code
              </h2>
              {session?.status === 'PAUSED' ? (
                <div className="text-center py-16">
                  <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-yellow-900/30 border-2 border-yellow-600 flex items-center justify-center">
                    <Pause size={48} className="text-yellow-500" />
                  </div>
                  <p className="text-yellow-400 mb-2 text-2xl font-bold">
                    Session Paused
                  </p>
                  <p className="text-gray-400 text-lg">
                    Students cannot mark attendance while the session is paused
                  </p>
                </div>
              ) : qrEnabled ? (
                <div className="flex justify-center">
                  <QRDisplay token={qrToken} rotationInterval={60000} />
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gray-800 flex items-center justify-center">
                    <QrCode size={48} className="text-gray-600" />
                  </div>
                  <p className="text-gray-400 mb-6 text-lg">
                    No QR code available
                  </p>
                  <button
                    onClick={toggleQR}
                    className="px-8 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition-all font-semibold"
                  >
                    🚀 Enable QR Code
                  </button>
                </div>
              )}
              <p className="text-center text-sm text-gray-400 mt-6">
                {session?.status === 'PAUSED'
                  ? '⏸️ Resume the session to allow students to mark attendance'
                  : qrEnabled 
                    ? '📱 Students should scan this QR code to mark their attendance'
                    : '💡 Enable QR code to allow students to mark attendance'
                }
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
