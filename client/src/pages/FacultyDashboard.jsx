import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import Loader from '../components/Loader';
import LocationPicker from '../components/LocationPicker';
import axiosInstance, { clearCache } from '../utils/axiosInstance';
import { Plus, Calendar, Users, MapPin, TrendingUp, AlertCircle, Clock, BarChart3, Play, Eye, Bell, UserPlus, X, Search } from 'lucide-react';

export default function FacultyDashboard() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [showStartSession, setShowStartSession] = useState(false);
  const [showManageStudents, setShowManageStudents] = useState(false);
  const [selectedClass, setSelectedClass] = useState(null);
  const [availableStudents, setAvailableStudents] = useState([]);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dashboardStats, setDashboardStats] = useState({
    activeSessions: 0,
    totalPresent: 0,
    totalExpected: 0,
    avgAttendance: 0,
    alerts: 0,
  });
  const [atRiskStudents, setAtRiskStudents] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    department: '',
    semester: '',
  });
  const [sessionData, setSessionData] = useState({
    title: '',
    location: null,
    sessionType: 'offline', // 'offline' or 'online'
    onlinePlatform: 'ZOOM', // 'ZOOM', 'GOOGLE_MEET', 'TEAMS'
    qrEnabled: true, // QR Code toggle
    faceVerification: false, // Face liveness toggle
    locationVerification: false, // Geofencing toggle
  });
  
  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds for live data
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);
  
  const fetchData = async () => {
    try {
      const [classesRes, sessionsRes] = await Promise.all([
        axiosInstance.get('/classes'),
        axiosInstance.get('/sessions'),
      ]);
      
      const allClasses = classesRes.data.data.classes;
      const allSessions = sessionsRes.data.data.sessions;
      
      // Calculate dashboard stats
      const liveSessions = allSessions.filter(s => s.status === 'LIVE');
      const totalPresent = liveSessions.reduce((sum, s) => sum + (s.attendanceCount || 0), 0);
      const totalExpected = liveSessions.reduce((sum, s) => sum + (s.totalStudents || 0), 0);
      const avgAttendance = totalExpected > 0 ? Math.round((totalPresent / totalExpected) * 100) : 0;
      
      setDashboardStats({
        activeSessions: liveSessions.length,
        totalPresent,
        totalExpected,
        avgAttendance,
        alerts: 0, // TODO: Fetch from alerts API
      });
      
      // Get classes with live sessions
      const liveSessionClassIds = liveSessions.map(s => s.class?._id || s.class);
      
      // Separate classes into live and non-live
      const classesWithLiveSessions = allClasses.filter(c => 
        liveSessionClassIds.includes(c._id)
      );
      const classesWithoutLiveSessions = allClasses.filter(c => 
        !liveSessionClassIds.includes(c._id)
      );
      
      // Show live sessions first, then others
      setClasses([...classesWithLiveSessions, ...classesWithoutLiveSessions]);
      setSessions(allSessions);
      
      // TODO: Fetch at-risk students and upcoming sessions from API
      setAtRiskStudents([]);
      setUpcomingSessions([]);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleCreateClass = async (e) => {
    e.preventDefault();
    try {
      const response = await axiosInstance.post('/classes', formData);
      const newClass = response.data.data.class;
      
      // Clear axios cache to force fresh data
      clearCache();
      
      // Optimistically add the new class to the UI immediately
      setClasses(prevClasses => [...prevClasses, newClass]);
      
      // Close modal and reset form
      setShowCreateClass(false);
      setFormData({
        name: '',
        code: '',
        description: '',
        department: '',
        semester: '',
      });
      
      // Refresh data in background to ensure consistency
      setTimeout(() => fetchData(), 100);
    } catch (error) {
      console.error('Error creating class:', error);
      const errorMsg = error.response?.data?.message || error.message || 'Failed to create class';
      alert(errorMsg);
    }
  };
  
  const openStartSessionModal = (cls) => {
    setSelectedClass(cls);
    setSessionData({
      title: `${cls.name} - Lecture`,
      location: null,
      sessionType: 'offline',
      onlinePlatform: 'ZOOM',
      qrEnabled: true,
      faceVerification: false,
      locationVerification: false,
    });
    setShowStartSession(true);
  };

  const openManageStudentsModal = async (cls) => {
    setSelectedClass(cls);
    setSelectedStudents(cls.students?.map(s => s._id || s) || []);
    setSearchQuery('');
    setShowManageStudents(true);
    
    // Fetch available students
    try {
      const response = await axiosInstance.get('/classes/students/available');
      setAvailableStudents(response.data.data.students);
    } catch (error) {
      console.error('Error fetching students:', error);
      alert('Failed to load students');
    }
  };

  const handleToggleStudent = (studentId) => {
    setSelectedStudents(prev => 
      prev.includes(studentId)
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    );
  };

  const handleSaveStudents = async () => {
    try {
      await axiosInstance.post(`/classes/${selectedClass._id}/students`, {
        studentIds: selectedStudents,
      });
      
      // Update local state
      const updatedClass = await axiosInstance.get(`/classes/${selectedClass._id}`);
      setClasses(prevClasses => 
        prevClasses.map(c => 
          c._id === selectedClass._id ? updatedClass.data.data.class : c
        )
      );
      
      setShowManageStudents(false);
      alert('Students enrolled successfully!');
    } catch (error) {
      console.error('Error enrolling students:', error);
      alert('Failed to enroll students: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleSelectAll = () => {
    const filteredStudents = availableStudents.filter(student => 
      searchQuery === '' ||
      student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      student.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      student.studentId?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setSelectedStudents(filteredStudents.map(s => s._id));
  };

  const handleDeselectAll = () => {
    setSelectedStudents([]);
  };

  const handleStartSession = async (e) => {
    e.preventDefault();

    // Location verification requires a real location before a session can start.
    if (
      sessionData.sessionType === 'offline' &&
      sessionData.locationVerification &&
      (
        !sessionData.location ||
        typeof sessionData.location.latitude !== 'number' ||
        typeof sessionData.location.longitude !== 'number'
      )
    ) {
      alert('Please click "Get Current Location" before starting a session with location verification enabled.');
      return;
    }

    try {
      // Create regular session first with verification settings
      const { data } = await axiosInstance.post('/sessions', {
        classId: selectedClass._id,
        title: sessionData.title,
        date: new Date(),
        startTime: new Date(),
        location: sessionData.sessionType === 'offline' ? sessionData.location : null,
        sessionType: sessionData.sessionType.toUpperCase(),
        qrEnabled: sessionData.qrEnabled,
        verificationRequirements: {
          qrCode: sessionData.qrEnabled,
          faceVerification: sessionData.faceVerification,
          locationVerification: sessionData.locationVerification,
        },
      });

      const sessionId = data.data.session._id;

      // If online session, create Zoom/Meet/Teams meeting
      if (sessionData.sessionType === 'online') {
        if (sessionData.onlinePlatform === 'ZOOM') {
          try {
            const zoomRes = await axiosInstance.post('/zoom/create', {
              sessionId,
              topic: sessionData.title,
              duration: 60,
            });
            
            // Navigate to monitor page
            setShowStartSession(false);
            navigate(`/online-session-monitor/${zoomRes.data.data.onlineSession._id}`);
          } catch (zoomError) {
            // If Zoom creation fails, show error and offer manual option
            const errorMsg = zoomError.response?.data?.message || 'Failed to create Zoom meeting';
            const useManual = confirm(
              `${errorMsg}\n\nWould you like to create a manual online session instead? You can add your Zoom link manually.`
            );
            
            if (useManual) {
              // Create generic online session
              const onlineRes = await axiosInstance.post('/online-sessions', {
                sessionId,
                platform: 'ZOOM',
                meetingLink: '', // Faculty can add manually
              });
              
              setShowStartSession(false);
              navigate(`/online-session-monitor/${onlineRes.data.data.onlineSession._id}`);
            } else {
              // Cancel and go to regular session
              setShowStartSession(false);
              navigate(`/session/${sessionId}`);
            }
          }
        } else {
          // For other platforms, create generic online session
          const onlineRes = await axiosInstance.post('/online-sessions', {
            sessionId,
            platform: sessionData.onlinePlatform,
            meetingLink: '', // Faculty can add manually
          });
          
          setShowStartSession(false);
          navigate(`/online-session-monitor/${onlineRes.data.data.onlineSession._id}`);
        }
      } else {
        // Offline session - navigate to QR code page
        setShowStartSession(false);
        navigate(`/session/${sessionId}`);
      }
    } catch (error) {
      console.error('Error starting session:', error);
      alert('Failed to start session: ' + (error.response?.data?.message || error.message));
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6 sm:mb-8">
              <div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  Faculty Dashboard
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm sm:text-base">Manage your classes and sessions</p>
              </div>
              <button
                onClick={() => setShowCreateClass(true)}
                className="btn-primary flex items-center gap-2 self-start sm:self-auto text-sm sm:text-base"
              >
                <Plus size={18} />
                <span>Create Class</span>
              </button>
            </div>

            {/* Dashboard Overview Section */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
              <div className="card-elevated p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Active Sessions</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboardStats.activeSessions}</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center">
                    <Play className="text-green-600 dark:text-green-400" size={24} />
                  </div>
                </div>
              </div>
              
              <div className="card-elevated p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Present Today</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">
                      {dashboardStats.totalPresent}/{dashboardStats.totalExpected}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                    <Users className="text-blue-600 dark:text-blue-400" size={24} />
                  </div>
                </div>
              </div>
              
              <div className="card-elevated p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Avg Attendance</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboardStats.avgAttendance}%</p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center">
                    <TrendingUp className="text-purple-600 dark:text-purple-400" size={24} />
                  </div>
                </div>
              </div>
              
              <div className="card-elevated p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Alerts Pending</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboardStats.alerts}</p>
                  </div>
                  <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/20 rounded-lg flex items-center justify-center">
                    <AlertCircle className="text-orange-600 dark:text-orange-400" size={24} />
                  </div>
                </div>
              </div>
            </div>

            {/* Live Sessions Panel */}
            {sessions.filter(s => s.status === 'LIVE' || s.status === 'PAUSED').length > 0 && (
              <div className="card-elevated p-6 mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
                    Active Sessions ({sessions.filter(s => s.status === 'LIVE' || s.status === 'PAUSED').length})
                  </h2>
                  <button 
                    onClick={() => navigate('/analytics')}
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    View All →
                  </button>
                </div>
                <div className="space-y-3">
                  {sessions.filter(s => s.status === 'LIVE' || s.status === 'PAUSED').slice(0, 3).map((session) => (
                    <div key={session._id} className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-gray-900 dark:text-white">{session.title}</h3>
                            {session.status === 'PAUSED' && (
                              <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-xs font-semibold rounded">
                                PAUSED
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {session.class?.name} • Started {new Date(session.startTime).toLocaleTimeString()}
                          </p>
                          <div className="flex items-center gap-4 mt-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {session.attendanceCount}/{session.totalStudents} Present
                            </span>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {Math.round((session.attendanceCount / session.totalStudents) * 100)}% Attendance
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => navigate(`/session/${session._id}`)}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                          >
                            <Eye size={16} />
                            View
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions Bar */}
            <div className="flex flex-wrap gap-3 mb-8">
              <button
                onClick={() => navigate('/analytics')}
                className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <BarChart3 size={18} />
                <span>View Analytics</span>
              </button>
              <button
                onClick={() => navigate('/analytics')}
                className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <Users size={18} />
                <span>Manage Students</span>
              </button>
              <button
                onClick={() => navigate('/analytics')}
                className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <Bell size={18} />
                <span>View Alerts</span>
              </button>
            </div>
            
            {showCreateClass && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
                <div className="card-elevated w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 sm:p-8 max-h-[90vh] overflow-y-auto">
                  <h2 className="text-2xl font-bold mb-6 text-gradient">Create New Class</h2>
                  <form onSubmit={handleCreateClass} className="space-y-4">
                    <input
                      type="text"
                      placeholder="Class Name (e.g., Data Structures)"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="input-primary"
                    />
                    <input
                      type="text"
                      placeholder="Class Code (e.g., CS101)"
                      required
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      className="input-primary"
                    />
                    <input
                      type="text"
                      placeholder="Department (e.g., Computer Science)"
                      required
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      className="input-primary"
                    />
                    <input
                      type="text"
                      placeholder="Semester (optional, e.g., Fall 2024)"
                      value={formData.semester}
                      onChange={(e) => setFormData({ ...formData, semester: e.target.value })}
                      className="input-primary"
                    />
                    <textarea
                      placeholder="Description (optional)"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="input-primary min-h-[80px]"
                    />
                    <div className="flex space-x-3 pt-2">
                      <button type="submit" className="btn-primary flex-1">
                        Create Class
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCreateClass(false)}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {showStartSession && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
                <div className="bg-[#1a1f35] border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-8">
                  <h2 className="text-xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-2">
                    Start New Session
                  </h2>
                  <p className="text-gray-400 mb-6 flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    {selectedClass?.name} ({selectedClass?.code})
                  </p>
                  
                  <form onSubmit={handleStartSession} className="space-y-6">
                    {/* Session Title */}
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-300">Session Title</label>
                      <input
                        type="text"
                        placeholder="Data Structures and Algorithms - Lecture"
                        required
                        value={sessionData.title}
                        onChange={(e) => setSessionData({ ...sessionData, title: e.target.value })}
                        className="w-full px-4 py-3 bg-[#0f1420] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                      />
                    </div>

                    {/* Session Type */}
                    <div>
                      <label className="block text-sm font-semibold mb-3 text-gray-300">Session Type</label>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          type="button"
                          onClick={() => setSessionData({ ...sessionData, sessionType: 'offline' })}
                          className={`p-6 border-2 rounded-xl transition-all ${
                            sessionData.sessionType === 'offline'
                              ? 'border-purple-500 bg-purple-600/20'
                              : 'border-gray-700 bg-[#0f1420] hover:border-gray-600'
                          }`}
                        >
                          <div className="text-4xl mb-3">🏫</div>
                          <div className="font-bold text-lg text-white">Offline Class</div>
                          <div className="text-xs text-gray-400 mt-1">QR Code Attendance</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSessionData({ ...sessionData, sessionType: 'online' })}
                          className={`p-6 border-2 rounded-xl transition-all ${
                            sessionData.sessionType === 'online'
                              ? 'border-purple-500 bg-purple-600/20'
                              : 'border-gray-700 bg-[#0f1420] hover:border-gray-600'
                          }`}
                        >
                          <div className="text-4xl mb-3">💻</div>
                          <div className="font-bold text-lg text-white">Online Class</div>
                          <div className="text-xs text-gray-400 mt-1">Zoom/Meet/Teams</div>
                        </button>
                      </div>
                    </div>

                    {sessionData.sessionType === 'online' && (
                      <div>
                        <label className="block text-sm font-semibold mb-2 text-gray-300">Online Platform</label>
                        <select
                          value={sessionData.onlinePlatform}
                          onChange={(e) => setSessionData({ ...sessionData, onlinePlatform: e.target.value })}
                          className="w-full px-4 py-3 bg-[#0f1420] border border-gray-700 rounded-xl text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        >
                          <option value="ZOOM">🎥 Zoom (Auto-create meeting)</option>
                          <option value="GOOGLE_MEET">📹 Google Meet</option>
                          <option value="TEAMS">💼 Microsoft Teams</option>
                          <option value="WEBRTC">🌐 Custom Platform</option>
                        </select>
                        <p className="text-xs text-gray-400 mt-2">
                          {sessionData.onlinePlatform === 'ZOOM' 
                            ? '✨ Zoom meeting will be created automatically with attendance tracking'
                            : 'You can add meeting link after creation'}
                        </p>
                      </div>
                    )}

                    {sessionData.sessionType === 'offline' && (
                      <>
                        {/* Verification Methods Section */}
                        <div className="space-y-4 pt-4 border-t border-gray-700">
                          <h4 className="font-semibold text-white">Verification Methods</h4>
                          
                          {/* QR Code Toggle */}
                          <div className="p-5 bg-[#0f1420] border border-gray-700 rounded-xl">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="text-2xl">📱</div>
                                <div>
                                  <div className="font-semibold text-white">Enable QR Code</div>
                                  <div className="text-sm text-gray-400">Students scan QR to mark attendance</div>
                                </div>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sessionData.qrEnabled}
                                  onChange={(e) => setSessionData({ ...sessionData, qrEnabled: e.target.checked })}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                              </label>
                            </div>
                          </div>
                          
                          {/* Face Liveness Toggle */}
                          <div className="p-5 bg-[#0f1420] border border-gray-700 rounded-xl">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="text-2xl">👤</div>
                                <div>
                                  <div className="font-semibold text-white">Enable Face Liveness</div>
                                  <div className="text-sm text-gray-400">Real-time movement check (not facial recognition)</div>
                                </div>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sessionData.faceVerification}
                                  onChange={(e) => setSessionData({ ...sessionData, faceVerification: e.target.checked })}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                              </label>
                            </div>
                          </div>
                          
                          {/* Geofencing Toggle */}
                          <div className="p-5 bg-[#0f1420] border border-gray-700 rounded-xl">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                                  <MapPin className="text-white" size={20} />
                                </div>
                                <div>
                                  <div className="font-semibold text-white">Enable Geofencing</div>
                                  <div className="text-sm text-gray-400">Require students to be at the session location</div>
                                </div>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sessionData.locationVerification}
                                  onChange={(e) => setSessionData({ ...sessionData, locationVerification: e.target.checked })}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                              </label>
                            </div>
                          </div>
                        </div>
                        
                        {sessionData.locationVerification && (
                          <LocationPicker
                            value={sessionData.location}
                            onChange={(location) => setSessionData({ ...sessionData, location })}
                          />
                        )}
                      </>
                    )}

                    <div className="flex space-x-3 pt-4">
                      <button
                        type="submit"
                        disabled={
                          sessionData.sessionType === 'offline' &&
                          sessionData.locationVerification &&
                          (
                            !sessionData.location ||
                            typeof sessionData.location.latitude !== 'number' ||
                            typeof sessionData.location.longitude !== 'number'
                          )
                        }
                        className="flex-1 px-6 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl transition-all font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-purple-600 disabled:hover:to-indigo-600"
                      >
                        <span>🚀</span>
                        <span>Start Session</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowStartSession(false)}
                        className="flex-1 px-6 py-4 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-all font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            
            {/* Manage Students Modal */}
            {showManageStudents && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
                <div className="bg-white dark:bg-[#1a1f35] border border-gray-200 dark:border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                  {/* Header */}
                  <div className="p-6 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Manage Students
                      </h2>
                      <button
                        onClick={() => setShowManageStudents(false)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      >
                        <X size={20} className="text-gray-600 dark:text-gray-400" />
                      </button>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400">
                      {selectedClass?.name} ({selectedClass?.code})
                    </p>
                    <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-1">
                      {selectedStudents.length} students selected
                    </p>
                  </div>

                  {/* Search Bar */}
                  <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                      <input
                        type="text"
                        placeholder="Search students by name, email, or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-[#0f1420] border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSelectAll}
                        className="px-3 py-1.5 text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors"
                      >
                        Select All
                      </button>
                      <button
                        onClick={handleDeselectAll}
                        className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  {/* Student List */}
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="space-y-2">
                      {availableStudents
                        .filter(student => 
                          searchQuery === '' ||
                          student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          student.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          student.studentId?.toLowerCase().includes(searchQuery.toLowerCase())
                        )
                        .map((student) => {
                          const isSelected = selectedStudents.includes(student._id);
                          return (
                            <div
                              key={student._id}
                              onClick={() => handleToggleStudent(student._id)}
                              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                                isSelected
                                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                                    isSelected
                                      ? 'bg-indigo-600 text-white'
                                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                                  }`}>
                                    {student.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <div className="font-semibold text-gray-900 dark:text-white">
                                      {student.name}
                                    </div>
                                    <div className="text-sm text-gray-600 dark:text-gray-400">
                                      {student.email} • {student.studentId}
                                    </div>
                                  </div>
                                </div>
                                <div className={`w-6 h-6 rounded border-2 flex items-center justify-center ${
                                  isSelected
                                    ? 'border-indigo-600 bg-indigo-600'
                                    : 'border-gray-300 dark:border-gray-600'
                                }`}>
                                  {isSelected && (
                                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="p-6 border-t border-gray-200 dark:border-gray-800">
                    <div className="flex gap-3">
                      <button
                        onClick={handleSaveStudents}
                        className="flex-1 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-semibold"
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => setShowManageStudents(false)}
                        className="px-6 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* My Classes Section */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                My Classes ({classes.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {classes.map((cls) => {
                  const liveSessions = sessions.filter(s => (s.status === 'LIVE' || s.status === 'PAUSED') && (s.class?._id === cls._id || s.class === cls._id));
                  const isLive = liveSessions.length > 0;
                  const completedSessions = sessions.filter(s => s.status === 'COMPLETED' && (s.class?._id === cls._id || s.class === cls._id));
                  const avgAttendance = completedSessions.length > 0
                    ? Math.round(completedSessions.reduce((sum, s) => sum + ((s.attendanceCount / s.totalStudents) * 100 || 0), 0) / completedSessions.length)
                    : 0;
                  const lastSession = completedSessions.length > 0 
                    ? completedSessions.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
                    : null;
                  
                  return (
                    <div key={cls._id} className={`card-elevated p-6 hover-lift ${isLive ? 'ring-2 ring-green-500' : ''}`}>
                      {isLive && (
                        <div className="flex items-center gap-2 mb-3">
                          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                          <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                            {liveSessions[0].status === 'PAUSED' ? 'SESSION PAUSED' : 'LIVE SESSION'}
                          </span>
                        </div>
                      )}
                      <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-white">{cls.name}</h3>
                      <p className="text-sm text-indigo-600 dark:text-indigo-400 font-semibold mb-4">{cls.code}</p>
                      
                      <div className="space-y-2 mb-4">
                        <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                          <Users size={16} />
                          <span>{cls.students?.length || 0} students enrolled</span>
                        </div>
                        {avgAttendance > 0 && (
                          <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                            <TrendingUp size={16} />
                            <span>Avg Attendance: {avgAttendance}%</span>
                          </div>
                        )}
                        {lastSession && (
                          <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                            <Clock size={16} />
                            <span>Last: {new Date(lastSession.date).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        {isLive ? (
                          <button
                            onClick={() => navigate(`/session/${liveSessions[0]._id}`)}
                            className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors flex items-center justify-center space-x-2 ${
                              liveSessions[0].status === 'PAUSED' 
                                ? 'bg-yellow-600 hover:bg-yellow-700' 
                                : 'bg-green-600 hover:bg-green-700'
                            }`}
                          >
                            <Eye size={18} />
                            <span>{liveSessions[0].status === 'PAUSED' ? 'View Paused' : 'View Live'}</span>
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => openStartSessionModal(cls)}
                              className="flex-1 btn-primary flex items-center justify-center space-x-2"
                            >
                              <Calendar size={18} />
                              <span>Start Session</span>
                            </button>
                            <button
                              onClick={() => openManageStudentsModal(cls)}
                              className="px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                              title="Manage Students"
                            >
                              <UserPlus size={18} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
