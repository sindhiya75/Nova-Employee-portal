import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { api, AttendanceRecord, MachineryItem, MobileTask, NotificationItem, SessionUser } from './services/api';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';

const C = { navy: '#1B2A4A', blue: '#2F6FED', green: '#1FA971', orange: '#F5941F', red: '#E63946', bg: '#F5F6FA', text: '#182033', muted: '#697386', border: '#DCE1EA' };

type Task = MobileTask;
type WorkLog = { date: string; quantity: string; description: string; status: 'Draft' | 'Submitted' };
type MachineryUsageEntry = { machineryId: number; machineryName: string; quantityUsed: number };

export default function App() {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  useEffect(() => { api.restoreSession().then(setSession).finally(() => setRestoring(false)); }, []);
  if (restoring) return <SafeAreaView style={s.loginScreen}><ActivityIndicator color="white" style={s.fill} /></SafeAreaView>;
  return session ? <Dashboard session={session} onLogout={() => setSession(null)} /> : <Login onSuccess={setSession} />;
}

function Login({ onSuccess }: { onSuccess: (user: SessionUser) => void }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ userId?: string; password?: string; auth?: string }>({});
  const canSubmit = !!userId.trim() && !!password && !loading;

  const login = async () => {
    const next: typeof errors = {};
    if (!userId.trim()) next.userId = 'Name is required.';
    if (!password) next.password = 'Password is required.';
    if (Object.keys(next).length) return setErrors(next);
    setErrors({}); setLoading(true);
    try { onSuccess(await api.login(userId.trim(), password)); }
    catch (error) { setErrors({ auth: error instanceof Error ? error.message : 'Unable to log in' }); }
    finally { setLoading(false); }
  };

  return <SafeAreaView style={s.loginScreen}><StatusBar style="light" /><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.fill}><View style={s.loginContent}>
    <Brand />
    <View style={s.loginCard}>
      <Text style={s.loginTitle}>Employee Login</Text><Text style={s.loginWelcome}>Welcome back. Sign in to continue.</Text>
      <Text style={s.label}>USERNAME</Text>
      <TextInput autoCapitalize="words" editable={!loading} onChangeText={(v) => { setUserId(v); setErrors((e) => ({ ...e, userId: undefined, auth: undefined })); }} placeholder="Enter your name" placeholderTextColor="#8A94A6" style={[s.input, errors.userId && s.inputError]} value={userId} />
      {errors.userId && <Text style={s.error}>{errors.userId}</Text>}
      <Text style={[s.label, { marginTop: 18 }]}>PASSWORD</Text>
      <View style={[s.passwordRow, errors.password && s.inputError]}><TextInput editable={!loading} onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: undefined, auth: undefined })); }} onSubmitEditing={canSubmit ? login : undefined} placeholder="Enter your password" placeholderTextColor="#8A94A6" secureTextEntry={!showPassword} style={s.passwordInput} value={password} /><Pressable hitSlop={8} onPress={() => setShowPassword((v) => !v)}><Text style={s.toggle}>{showPassword ? 'HIDE' : 'SHOW'}</Text></Pressable></View>
      {errors.password && <Text style={s.error}>{errors.password}</Text>}{errors.auth && <Text style={s.authError}>{errors.auth}</Text>}
      <Pressable disabled={!canSubmit} onPress={login} style={({ pressed }) => [s.loginButton, !canSubmit && s.disabled, pressed && canSubmit && { opacity: .86 }]}>{loading ? <View style={s.row}><ActivityIndicator color="white" /><Text style={s.buttonText}>Authenticating...</Text></View> : <Text style={s.buttonText}>Login</Text>}</Pressable>
    </View><Text style={s.hint}>Enter any name and use password: 1234</Text>
  </View></KeyboardAvoidingView></SafeAreaView>;
}

function Brand() { return <View style={s.brand}><Text style={s.logo}>NOVA<Text style={{ color: '#6EA0FF' }}>+</Text></Text><Text style={s.brandSub}>PROJECT MANAGEMENT</Text></View>; }

function Dashboard({ session, onLogout }: { session: SessionUser; onLogout: () => void }) {
  const drawerX = useRef(new Animated.Value(-310)).current;
  const employeeName = session.EmployeeName || session.Name;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<Record<string, WorkLog[]>>({});
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const toggleDrawer = (open: boolean) => { setDrawerOpen(open); Animated.spring(drawerX, { toValue: open ? 0 : -310, useNativeDriver: true, bounciness: 0 }).start(); };
  const refresh = async () => { setDashboardError(''); try { const [nextTasks, nextAttendance, noticeData] = await Promise.all([api.tasks(), api.attendanceToday(), api.notifications()]); setTasks(nextTasks); setAttendance(nextAttendance); setNotifications(noticeData.notifications); setUnreadCount(noticeData.unreadCount); } catch (error) { setDashboardError(error instanceof Error ? error.message : 'Unable to load dashboard'); } finally { setLoadingDashboard(false); } };
  useEffect(() => { refresh(); }, []);
  const attendanceAction = async () => { setAttendanceBusy(true); try { setAttendance(attendance?.CheckInTime ? await api.checkOut() : await api.checkIn()); } catch (error) { Alert.alert('Attendance error', error instanceof Error ? error.message : 'Please try again.'); } finally { setAttendanceBusy(false); } };
  const openNotifications = () => { setNotificationsOpen(true); setUnreadCount(0); };
  const formatTime = (value: string | null | undefined) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return <SafeAreaView style={[s.appScreen, { paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 24 : 0 }]}>
    <StatusBar backgroundColor="#FFFFFF" style="dark" translucent={false} />
    <View style={s.topbar}><Pressable accessibilityLabel="Open navigation" hitSlop={10} onPress={() => toggleDrawer(true)} style={s.menuButton}><Text style={s.menuIcon}>☰</Text></Pressable><Text style={s.topbarTitle}>Employee Portal</Text><Pressable accessibilityLabel="Notifications" onPress={openNotifications} style={s.bellButton}><Text style={s.bellIcon}>🔔</Text>{unreadCount > 0 && <View style={s.notificationDot}><Text style={s.notificationBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text></View>}</Pressable></View>
    <ScrollView contentContainerStyle={s.dashboard} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}><View style={s.headerCopy}><Text style={s.greeting}>Hello, {employeeName}</Text><Text style={s.intro}>Follow the steps below to manage your workday.</Text></View><Pressable onPress={() => setEmergencyOpen(true)} style={s.emergencyButton}><Text style={s.emergencyText}>⚠ Emergency Info</Text></Pressable></View>
      {dashboardError ? <Pressable onPress={refresh} style={s.errorCard}><Text style={s.errorCardText}>{dashboardError}</Text><Text style={s.retryText}>Tap to retry</Text></Pressable> : null}
      <AttendanceCard attendance={attendance} busy={attendanceBusy} loading={loadingDashboard} onAction={attendanceAction} formatTime={formatTime} session={session} onAttendanceChange={setAttendance} tasks={tasks} />
      <View style={s.card}><Text style={s.activeTitle}>Active Work</Text><Text style={s.activeSub}>Click into a task to log your daily work progress.</Text>{loadingDashboard ? <ActivityIndicator color={C.blue} style={{ margin: 24 }} /> : tasks.length ? <View style={s.taskList}>{tasks.map((task, index) => <TaskRow key={task.id} task={task} last={index === tasks.length - 1} onPress={() => setSelectedTask(task)} />)}</View> : <Text style={s.emptyHistory}>No active work assigned.</Text>}</View>
    </ScrollView>

    {drawerOpen && <Pressable onPress={() => toggleDrawer(false)} style={s.scrim} />}
    <Animated.View style={[s.drawer, { top: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 24 : 0, transform: [{ translateX: drawerX }] }]}><SafeAreaView style={s.fill}><View style={s.drawerBrand}><Text style={s.drawerLogo}>NOVA<Text style={{ color: '#FFFFFF' }}>+</Text></Text><Text style={s.drawerSubtitle}>PROJECT MANAGEMENT</Text></View><Pressable onPress={() => toggleDrawer(false)} style={s.activeNav}><Text style={s.navIcon}>▦</Text><Text style={s.navText}>Employee Portal</Text></Pressable><View style={s.drawerSpacer} /><View style={s.safetyCard}><Text style={s.shield}>⬟</Text><View><Text style={s.safetyTitle}>Safety First</Text><Text style={s.safetyGreen}>Zero Accident</Text><Text style={s.safetyCaption}>Our Goal</Text></View></View><View style={s.employeeCard}><View style={s.avatar}><Text style={s.avatarText}>{employeeName.charAt(0).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={s.employeeName}>{employeeName}</Text><Text style={s.employeeRole}>{session.Role}</Text></View><Pressable accessibilityLabel="Log out" hitSlop={8} onPress={async () => { await api.logout(); onLogout(); }}><Text style={s.logout}>↪</Text></Pressable></View></SafeAreaView></Animated.View>
    <EmergencyModal open={emergencyOpen} onClose={() => setEmergencyOpen(false)} />
    <NotificationPanel notifications={notifications} open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    <TaskDetail task={selectedTask} completed={selectedTask ? !!completed[selectedTask.id] || selectedTask.status === 'Closed' : false} logs={selectedTask ? logs[selectedTask.id] ?? [] : []} onClose={() => setSelectedTask(null)} onComplete={async (task) => { await api.closeTask(task.numericId); setCompleted((current) => ({ ...current, [task.id]: true })); setTasks((current) => current.map((item) => item.numericId === task.numericId ? { ...item, status: 'Closed', progress: 100 } : item)); refresh(); }} onSave={(taskId, log) => setLogs((current) => ({ ...current, [taskId]: [log, ...(current[taskId] ?? [])] }))} />
  </SafeAreaView>;
}

function AttendanceCard({ attendance, busy, loading, onAction, formatTime, session, onAttendanceChange, tasks }: { attendance: AttendanceRecord | null; busy: boolean; loading: boolean; onAction: () => void; formatTime: (value: string | null | undefined) => string; session: SessionUser; onAttendanceChange: (record: AttendanceRecord) => void; tasks: Task[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveReason, setLeaveReason] = useState('');
  const [marking, setMarking] = useState(false);
  const expansion = useRef(new Animated.Value(0)).current;

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const attendanceDate = attendance ? new Date(attendance.AttendanceDate) : null;
  const attendanceDay = attendanceDate && !Number.isNaN(attendanceDate.getTime())
    ? `${attendanceDate.getFullYear()}-${String(attendanceDate.getMonth() + 1).padStart(2, '0')}-${String(attendanceDate.getDate()).padStart(2, '0')}`
    : attendance ? String(attendance.AttendanceDate).slice(0, 10) : '';
  const validTodayRecord = Boolean(
    attendance &&
    Number(attendance.EmployeeId) === Number(session.EmployeeId) &&
    attendanceDay === today,
  );
  const state: 'not-checked-in' | 'checked-in' | 'checked-out' =
    validTodayRecord && attendance?.CheckInTime && attendance?.CheckOutTime
      ? 'checked-out'
      : validTodayRecord && attendance?.CheckInTime
        ? 'checked-in'
        : 'not-checked-in';

  useEffect(() => {
    Animated.timing(expansion, {
      toValue: state === 'checked-in' ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [state, expansion]);

  const baseUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:5001/api').replace(/\/$/, '');
  const requestHeaders = { 'Content-Type': 'application/json', ...(session.Token ? { Authorization: `Bearer ${session.Token}` } : {}), 'x-user-id': String(session.UserId), 'x-user-role': session.Role, ...(session.EmployeeId ? { 'x-employee-id': String(session.EmployeeId) } : {}) };

  const closeLeave = () => {
    setLeaveOpen(false);
    setLeaveReason('');
  };

  const toggleMenu = () => {
    setMenuOpen((open) => {
      if (open) closeLeave();
      return !open;
    });
  };

  const markLeave = async () => {
    if (!leaveReason.trim()) {
      Alert.alert('Reason required', 'Enter a reason for leave.');
      return;
    }
    setMarking(true);
    try {
      const response = await fetch(`${baseUrl}/leave-permission`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ requestType: 'Full Day Leave', fromDate: today, toDate: today, reason: leaveReason.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'Unable to mark leave');
      closeLeave();
      setMenuOpen(false);
      Alert.alert('Leave submitted', 'Your leave request was sent for approval.');
    } catch (error) {
      Alert.alert('Leave request failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setMarking(false);
    }
  };

  const confirmLate = async () => {
    setMarking(true);
    try {
      const response = await fetch(`${baseUrl}/attendance/check-in`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ status: 'Late', remarks: 'Marked late from NOVA+ employee portal' }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'Unable to mark late');
      onAttendanceChange(data);
      setMenuOpen(false);
      Alert.alert('Attendance updated', 'Today has been marked late.');
    } catch (error) {
      Alert.alert('Unable to mark late', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setMarking(false);
    }
  };

  const markLate = () => Alert.alert(
    'Mark Late',
    'Confirm that you are checking in late today.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: confirmLate }],
  );

  const activeTasks = tasks.filter((task) => task.status === 'Running');

  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={{ width: 22 }} />
        <Text style={s.attendanceCenteredLabel}>ATTENDANCE</Text>
        <Pressable accessibilityLabel="Attendance options" hitSlop={10} onPress={toggleMenu}>
          <Text style={s.dots}>⋮</Text>
        </Pressable>
      </View>

      {menuOpen && (
        <View style={s.attendanceMenu}>
          <Pressable onPress={() => setLeaveOpen(true)} style={s.attendanceMenuItem}>
            <View style={[s.attendanceMenuIcon, s.leaveMenuIcon]}><Text style={s.leaveMenuIconText}>L</Text></View>
            <View style={s.attendanceMenuCopy}><Text style={s.attendanceMenuText}>Leave</Text><Text style={s.attendanceMenuHint}>Request leave for today</Text></View>
          </Pressable>
          <Pressable disabled={marking} onPress={markLate} style={s.attendanceMenuItem}>
            <View style={[s.attendanceMenuIcon, s.lateMenuIcon]}><Text style={s.lateMenuIconText}>◷</Text></View>
            <View style={s.attendanceMenuCopy}><Text style={s.attendanceMenuText}>Late</Text><Text style={s.attendanceMenuHint}>Record a late arrival</Text></View>
          </Pressable>
        </View>
      )}

      {leaveOpen && (
        <View style={s.leaveForm}>
          <TextInput multiline onChangeText={setLeaveReason} placeholder="Enter reason for leave..." placeholderTextColor="#8A94A6" style={s.leaveReasonInput} textAlignVertical="top" value={leaveReason} />
          <View style={s.leaveActions}>
            <Pressable disabled={marking} onPress={closeLeave} style={s.leaveCancel}>
              <Text style={s.leaveCancelText}>Cancel</Text>
            </Pressable>
            <Pressable disabled={marking} onPress={markLeave} style={s.leaveSubmit}>
              {marking ? <ActivityIndicator color="white" size="small" /> : <Text style={s.buttonText}>Submit</Text>}
            </Pressable>
          </View>
        </View>
      )}

      {loading && <ActivityIndicator color={C.blue} style={{ margin: 24 }} />}

      {!loading && state === 'not-checked-in' && (
        <Pressable disabled={busy} onPress={onAction} style={s.centeredCheckIn}>
          {busy ? <ActivityIndicator color="white" /> : <Text style={s.attendanceButtonText}>Check In</Text>}
        </Pressable>
      )}

      {!loading && state === 'checked-in' && (
        <>
          <Text style={s.checkedInTitle}>You're currently checked in.</Text>
          <Text style={s.shiftSub}>Checked in at {formatTime(attendance?.CheckInTime)}</Text>
          <Animated.View style={[s.attendanceExpanded, { maxHeight: expansion.interpolate({ inputRange: [0, 1], outputRange: [0, 420] }), opacity: expansion }]}>
            <Text style={s.attendanceTaskHeading}>ASSIGNED TASK</Text>
            {tasks.length ? tasks.slice(0, 3).map((task) => (
              <View key={task.id} style={s.attendanceTaskRow}>
                <Text style={s.attendanceTaskName}>{task.id}  {task.name}</Text>
                <Text style={s.attendanceTaskMeta}>{task.workArea} • {task.progress}%</Text>
              </View>
            )) : <Text style={s.attendanceEmptyTask}>No tasks assigned for today.</Text>}
            <Text style={s.attendanceTaskHeading}>ACTIVE TASK</Text>
            {activeTasks.length ? (
              <View style={s.attendanceTaskRow}>
                <Text style={s.attendanceTaskName}>{activeTasks[0].id}  {activeTasks[0].name}</Text>
                <Text style={s.attendanceTaskMeta}>{activeTasks[0].workArea} • {activeTasks[0].progress}%</Text>
              </View>
            ) : <Text style={s.attendanceEmptyTask}>No task is currently in progress.</Text>}
          </Animated.View>
          <Pressable disabled={busy} onPress={onAction} style={[s.attendanceButton, s.checkoutButton]}>
            {busy ? <ActivityIndicator color={C.red} /> : <Text style={[s.attendanceButtonText, { color: C.red }]}>Check Out</Text>}
          </Pressable>
        </>
      )}

      {!loading && state === 'checked-out' && (
        <>
          <View style={s.attendanceIcon}><Text style={{ fontSize: 22 }}>✓</Text></View>
          <Text style={s.shiftTitle}>Your shift has ended for today.</Text>
          <Text style={s.shiftSub}>Worked from {formatTime(attendance?.CheckInTime)} to {formatTime(attendance?.CheckOutTime)}</Text>
        </>
      )}
    </View>
  );
}

function TaskRow({ task, last, onPress }: { task: Task; last: boolean; onPress: () => void }) {
  const statusColor = ['Completed', 'Closed'].includes(task.status) ? C.green : task.status === 'Running' ? C.orange : '#7A8496';
  return <Pressable onPress={onPress} style={({ pressed }) => [s.taskRow, last && { borderBottomWidth: 0 }, pressed && { backgroundColor: '#F7F9FD' }]}><View style={s.taskMain}><Text style={s.taskName}>{task.id}  {task.name}</Text><Text style={s.taskArea}>{task.area}</Text><View style={s.progressTrack}><View style={[s.progressFill, { width: `${task.progress}%` }]} /></View></View><View style={s.taskMeta}><Text style={s.due}>▣ {task.due}</Text><Text style={s.progress}>{task.progress}% Done</Text><View style={[s.pill, { backgroundColor: `${statusColor}18` }]}><Text style={[s.pillText, { color: statusColor }]}>{task.status}</Text></View></View></Pressable>;
}

function TaskDetail({ task, completed, logs, onClose, onComplete, onSave }: { task: Task | null; completed: boolean; logs: WorkLog[]; onClose: () => void; onComplete: (task: Task) => Promise<void>; onSave: (id: string, log: WorkLog) => void }) {
  const [pileCap, setPileCap] = useState(''); const [quantity, setQuantity] = useState(''); const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState(''); const [longitude, setLongitude] = useState(''); const [machinery, setMachinery] = useState<MachineryItem[]>([]); const [machineryEntries, setMachineryEntries] = useState<MachineryUsageEntry[]>([]); const [machineryFormOpen, setMachineryFormOpen] = useState(false); const [machineryPickerOpen, setMachineryPickerOpen] = useState(false); const [machinerySearch, setMachinerySearch] = useState(''); const [selectedMachineryId, setSelectedMachineryId] = useState<number | null>(null); const [machineryQuantity, setMachineryQuantity] = useState('0'); const [editingMachineryIndex, setEditingMachineryIndex] = useState<number | null>(null); const [locating, setLocating] = useState(false);
  const [showNewEntry, setShowNewEntry] = useState(false);
  useEffect(() => { if (task) api.machinery().then(setMachinery).catch((error) => Alert.alert('Machinery list unavailable', error instanceof Error ? error.message : 'Please try again.')); }, [task?.numericId]);
  if (!task) return null;
  const [project, workArea] = task.area.split(' / ');
  const submittedLogs = logs.filter((log) => log.status === 'Submitted');
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const reset = () => { setPileCap(''); setQuantity(''); setDescription(''); setLatitude(''); setLongitude(''); setMachineryEntries([]); setMachineryFormOpen(false); };
  const save = async (status: WorkLog['status']) => {
    if (!quantity.trim() || !description.trim()) return Alert.alert('Missing information', 'Enter today’s quantity and completed work.');
    try { if (status === 'Submitted') await api.submitProgress(task.numericId, quantity.trim(), description.trim(), machineryEntries); onSave(task.id, { date: today, quantity: quantity.trim(), description: description.trim(), status }); reset(); if (status === 'Submitted') setShowNewEntry(false); Alert.alert(status === 'Draft' ? 'Draft saved' : 'Log submitted', `Work log for ${task.id} was ${status.toLowerCase()}.`); }
    catch (error) { Alert.alert('Unable to submit log', error instanceof Error ? error.message : 'Please try again.'); }
  };
  const locate = async () => { setLocating(true); try { const permission = await Location.requestForegroundPermissionsAsync(); if (permission.status !== 'granted') return Alert.alert('Location permission needed', 'Allow location access to capture GPS coordinates.'); const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }); setLatitude(position.coords.latitude.toFixed(6)); setLongitude(position.coords.longitude.toFixed(6)); } catch { Alert.alert('Location unavailable', 'Could not read the current GPS position.'); } finally { setLocating(false); } };
  return <Modal animationType="slide" onRequestClose={onClose} visible><SafeAreaView style={s.detailScreen}><StatusBar style="dark" /><View style={s.detailTop}><Text style={s.detailTopTitle}>Task Detail</Text><Pressable hitSlop={12} onPress={onClose}><Text style={s.detailClose}>×</Text></Pressable></View><ScrollView contentContainerStyle={s.detailContent} keyboardShouldPersistTaps="handled">
    <Text style={s.detailTitle}>{task.name}</Text><Text style={s.detailId}>{task.id}</Text>
    <View style={s.summary}><View style={s.summaryCell}><Text style={s.summaryLabel}>PROJECT</Text><Text style={s.summaryValue}>{project}</Text></View><View style={s.summaryDivider} /><View style={s.summaryCell}><Text style={s.summaryLabel}>WORK AREA</Text><Text style={s.summaryValue}>{workArea}</Text></View><View style={s.summaryDivider} /><View style={s.summaryCell}><Text style={s.summaryLabel}>PROGRESS</Text><Text style={s.summaryValue}>{completed ? 100 : task.progress}% • {task.completedQuantity}/{task.plannedQuantity} {task.unit}</Text></View></View>
    <Text style={s.taskDescription}>Generated task for full dashboard testing</Text><View style={s.detailActions}><View><View style={[s.pill, { alignSelf: 'flex-start', backgroundColor: completed ? '#1FA97118' : '#F5941F18' }]}><Text style={[s.pillText, { color: completed ? C.green : C.orange }]}>{completed ? 'Completed' : task.status}</Text></View><Text style={s.detailDue}>Due: {task.due}</Text></View><Pressable disabled={completed} onPress={async () => { try { await onComplete(task); Alert.alert('Task completed', `${task.id} has been marked complete.`); onClose(); } catch (error) { Alert.alert('Unable to complete task', error instanceof Error ? error.message : 'Please try again.'); } }} style={[s.outlineButton, completed && { opacity: .45 }]}><Text style={s.outlineButtonText}>{completed ? 'Completed' : 'Mark as Complete'}</Text></Pressable></View>
    <Text style={s.workLogTitle}>Daily Work Log</Text>{(submittedLogs.length === 0 || showNewEntry) && <View style={s.logForm}><Text style={s.formTitle}>Log Today’s Work ({today})</Text><View style={s.entryInfo}><View style={s.entryCell}><Text style={s.summaryLabel}>ENTRY DATE</Text><Text style={s.summaryValue}>{today}</Text></View><View style={s.entryCell}><Text style={s.summaryLabel}>AREA</Text><Text style={s.summaryValue}>{workArea}</Text></View></View>
    <TextInput onChangeText={setPileCap} placeholder="Pile Cap No" placeholderTextColor="#7D8798" style={s.formInput} value={pileCap} /><TextInput keyboardType="decimal-pad" onChangeText={setQuantity} placeholder="Today’s Quantity" placeholderTextColor="#7D8798" style={[s.formInput, { width: '52%' }]} value={quantity} /><Text style={s.formLabel}>Today’s Done Work</Text><TextInput multiline onChangeText={setDescription} placeholder="Describe the work completed today..." placeholderTextColor="#8E96A5" style={s.textarea} textAlignVertical="top" value={description} />
    <View style={s.gpsRow}><TextInput editable={false} placeholder="GPS Latitude" placeholderTextColor="#7D8798" style={[s.formInput, s.gpsInput]} value={latitude} /><TextInput editable={false} placeholder="GPS Longitude" placeholderTextColor="#7D8798" style={[s.formInput, s.gpsInput]} value={longitude} /><Pressable disabled={locating} onPress={locate} style={s.locateButton}><Text style={s.locateIcon}>{locating ? '…' : '●'}</Text></Pressable></View>
    <View style={s.equipmentBox}><Text style={s.machinerySectionTitle}>Machinery Usage</Text>{!machineryFormOpen && machineryEntries.length === 0 && <Pressable onPress={() => setMachineryFormOpen(true)} style={s.addMachineryPrimary}><Text style={s.addEquipmentText}>＋ Add Machinery</Text></Pressable>}{machineryFormOpen && <View style={s.machineryEntryForm}><Text style={s.formLabel}>Machinery Name</Text><Pressable onPress={() => setMachineryPickerOpen(true)} style={s.machinerySelect}><Text style={selectedMachineryId ? s.machinerySelectValue : s.machinerySelectPlaceholder}>{machinery.find((item) => item.MachineryId === selectedMachineryId)?.MachineryName || '▼  Select Machinery'}</Text></Pressable><Text style={s.formLabel}>Quantity Used</Text><TextInput keyboardType="number-pad" maxLength={4} onChangeText={(value) => setMachineryQuantity(value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '') || '0')} selectTextOnFocus style={s.machineryEntryQuantity} value={machineryQuantity} /><Pressable onPress={() => { const selected = machinery.find((item) => item.MachineryId === selectedMachineryId); if (!selected) return Alert.alert('Select machinery', 'Choose a machinery name first.'); const entry = { machineryId: selected.MachineryId, machineryName: selected.MachineryName, quantityUsed: Number(machineryQuantity || 0) }; setMachineryEntries((entries) => editingMachineryIndex === null ? [...entries, entry] : entries.map((item, index) => index === editingMachineryIndex ? entry : item)); setSelectedMachineryId(null); setMachineryQuantity('0'); setEditingMachineryIndex(null); setMachineryFormOpen(false); }} style={s.machineryAddButton}><Text style={s.buttonText}>{editingMachineryIndex === null ? 'Add' : 'Update'}</Text></Pressable></View>}{machineryEntries.length > 0 && <View style={s.addedMachinery}><Text style={s.addedMachineryTitle}>Added Machinery</Text>{machineryEntries.map((entry, index) => <View key={`${entry.machineryId}-${index}`} style={s.addedMachineryRow}><Text style={s.addedMachineryCheck}>✓</Text><Text style={s.addedMachineryName}>{entry.machineryName}</Text><Text style={s.addedMachineryQty}>Qty: {entry.quantityUsed}</Text><Pressable onPress={() => { setSelectedMachineryId(entry.machineryId); setMachineryQuantity(String(entry.quantityUsed)); setEditingMachineryIndex(index); setMachineryFormOpen(true); }}><Text style={s.machineryEdit}>✎</Text></Pressable><Pressable onPress={() => setMachineryEntries((entries) => entries.filter((_, itemIndex) => itemIndex !== index))}><Text style={s.machineryDelete}>⌫</Text></Pressable></View>)}{!machineryFormOpen && <Pressable onPress={() => { setSelectedMachineryId(null); setMachineryQuantity('0'); setEditingMachineryIndex(null); setMachineryFormOpen(true); }} style={s.addAnotherMachinery}><Text style={s.addEquipmentText}>＋ Add Another Machinery</Text></Pressable>}<Pressable onPress={() => { setMachineryFormOpen(false); Alert.alert('Machinery saved', 'Machinery usage will be stored with this daily progress report.'); }} style={s.machinerySaveButton}><Text style={s.buttonText}>Save</Text></Pressable></View>}</View>
    <View style={s.formActions}><Pressable onPress={() => save('Draft')} style={s.outlineButton}><Text style={s.outlineButtonText}>▣ Save Draft</Text></Pressable><Pressable onPress={() => save('Submitted')} style={s.submitButton}><Text style={s.buttonText}>➤ Submit Log</Text></Pressable></View></View>}
    <View style={s.historyHeader}><Text style={s.summaryLabel}>LOG HISTORY</Text><View style={s.historyActions}>{submittedLogs.length > 0 && !showNewEntry && <Pressable onPress={() => setShowNewEntry(true)} style={s.outlineButton}><Text style={s.outlineButtonText}>＋ Add Entry</Text></Pressable>}<Pressable onPress={async () => { if (!submittedLogs.length) return Alert.alert('No logs', 'Submit a work log before exporting.'); const rows = submittedLogs.map((log) => `<tr><td>${log.date}</td><td>${log.quantity}</td><td>${log.description.replace(/[<>&]/g, '')}</td></tr>`).join(''); const file = await Print.printToFileAsync({ html: `<h1>${task.name}</h1><p>${task.id} • ${task.project} / ${task.workArea}</p><table border="1" cellpadding="8" cellspacing="0"><tr><th>Date</th><th>Quantity</th><th>Work completed</th></tr>${rows}</table>` }); if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: `${task.id} work logs` }); else Alert.alert('PDF created', file.uri); }} style={s.outlineButton}><Text style={s.outlineButtonText}>▣ Export PDF</Text></Pressable></View></View>{submittedLogs.length === 0 ? <Text style={s.emptyHistory}>No work logged yet.</Text> : submittedLogs.map((log, index) => <View key={`${log.date}-${index}`} style={s.historyCard}><View style={s.historyRow}><Text style={s.historyDate}>{log.date}</Text><View style={[s.pill, { backgroundColor: '#1FA97118' }]}><Text style={[s.pillText, { color: C.green }]}>Submitted</Text></View></View><Text style={s.historyFieldLabel}>TodayQuantity</Text><Text style={s.historyQty}>{log.quantity}</Text><Text style={s.historyFieldLabel}>Today’s Done Work</Text><View style={s.historyDescriptionBox}><Text style={s.historyDescription}>{log.description}</Text></View><View style={s.historyDivider} /><Pressable onPress={async () => { try { await api.requestEdit(task.numericId, `Please allow editing the ${log.date} work log: ${log.description}`); Alert.alert('Edit request sent', 'Your request was sent for manager approval.'); } catch (error) { Alert.alert('Request failed', error instanceof Error ? error.message : 'Please try again.'); } }} style={s.requestEditButton}><Text style={s.requestEdit}>✎ Request Edit</Text></Pressable></View>)}
  </ScrollView><Modal animationType="fade" onRequestClose={() => setMachineryPickerOpen(false)} transparent visible={machineryPickerOpen}><View style={s.pickerBackdrop}><Pressable onPress={() => setMachineryPickerOpen(false)} style={StyleSheet.absoluteFill} /><View style={s.pickerCard}><Text style={s.pickerTitle}>Select Machinery</Text><TextInput autoFocus onChangeText={setMachinerySearch} placeholder="Search machinery..." style={s.pickerSearch} value={machinerySearch} /><ScrollView style={s.pickerList}>{machinery.filter((item) => item.MachineryName.toLowerCase().includes(machinerySearch.toLowerCase()) || item.MachineryCode.toLowerCase().includes(machinerySearch.toLowerCase())).map((item) => <Pressable key={item.MachineryId} onPress={() => { setSelectedMachineryId(item.MachineryId); setMachineryPickerOpen(false); setMachinerySearch(''); }} style={s.pickerOption}><Text style={s.pickerOptionName}>{item.MachineryName}</Text><Text style={s.machineryCode}>{item.MachineryCode}</Text></Pressable>)}</ScrollView><Pressable onPress={() => setMachineryPickerOpen(false)} style={s.notificationClose}><Text style={s.outlineButtonText}>Cancel</Text></Pressable></View></View></Modal></SafeAreaView></Modal>;
}

function NotificationPanel({ notifications, open, onClose }: { notifications: NotificationItem[]; open: boolean; onClose: () => void }) {
  return <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}><View style={s.notificationBackdrop}><Pressable onPress={onClose} style={StyleSheet.absoluteFill} /><View style={s.notificationPanel}><View style={s.notificationHeader}><Text style={s.notificationTitle}>Notifications</Text><View style={s.newBadge}><Text style={s.newBadgeText}>0 new</Text></View></View><ScrollView style={s.notificationList}>{notifications.length ? notifications.map((item) => <View key={item.id} style={s.notificationCard}><Text style={s.notificationCategory}>{item.title}</Text><Text style={s.notificationMessage}>{item.message}</Text><Text style={s.notificationTime}>{new Date(item.createdAt).toLocaleString()}</Text></View>) : <Text style={s.emptyHistory}>No notifications yet.</Text>}</ScrollView><Pressable onPress={onClose} style={s.notificationClose}><Text style={s.outlineButtonText}>Close</Text></Pressable></View></View></Modal>;
}

function EmergencyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const call = async (phone: string) => { const url = `tel:${phone}`; if (await Linking.canOpenURL(url)) Linking.openURL(url); else Alert.alert('Calling is unavailable', phone); };
  const Contact = ({ name, phone }: { name: string; phone: string }) => <Pressable onPress={() => call(phone)} style={s.contact}><Text style={s.contactName}>{name}</Text><Text style={s.phone}>{phone}</Text></Pressable>;
  return <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}><View style={s.modalBackdrop}><Pressable onPress={onClose} style={StyleSheet.absoluteFill} /><View style={s.sheet}><View style={s.handle} /><View style={s.warningCircle}><Text style={{ fontSize: 26 }}>⚠</Text></View><Text style={s.modalTitle}>Emergency Contacts</Text><Text style={s.modalCopy}>In case of emergency, please contact the appropriate service or your project heads immediately.</Text><Text style={s.contactHeading}>GOVERNMENT SERVICES</Text><Contact name="Police" phone="100" /><Contact name="Ambulance" phone="108" /><Contact name="Fire" phone="101" /><Text style={s.contactHeading}>PROJECT MANAGEMENT</Text><Contact name="Site Supervisor" phone="+91 98765 43210" /><Contact name="Project Manager" phone="+91 98765 43211" /><Pressable onPress={onClose} style={s.closeButton}><Text style={s.buttonText}>Close</Text></Pressable></View></View></Modal>;
}

const shadow = { shadowColor: '#17213A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: .08, shadowRadius: 12, elevation: 4 };
const s = StyleSheet.create({
  fill: { flex: 1 }, row: { alignItems: 'center', flexDirection: 'row', gap: 10 }, loginScreen: { backgroundColor: C.navy, flex: 1 }, loginContent: { flex: 1, justifyContent: 'center', padding: 24 }, brand: { alignItems: 'center' }, logo: { color: 'white', fontSize: 44, fontWeight: '900' }, brandSub: { color: '#9DAAC1', fontSize: 10, fontWeight: '700', letterSpacing: 2.6 }, loginCard: { ...shadow, backgroundColor: 'white', borderRadius: 14, marginTop: 36, padding: 24 }, loginTitle: { color: C.text, fontSize: 24, fontWeight: '800', textAlign: 'center' }, loginWelcome: { color: C.muted, marginBottom: 26, marginTop: 7, textAlign: 'center' }, label: { color: '#626D7F', fontSize: 11, fontWeight: '800', letterSpacing: 1.1, marginBottom: 8 }, input: { borderColor: C.border, borderRadius: 10, borderWidth: 1.5, color: C.text, fontSize: 16, height: 52, paddingHorizontal: 15 }, passwordRow: { alignItems: 'center', borderColor: C.border, borderRadius: 10, borderWidth: 1.5, flexDirection: 'row', height: 52, paddingRight: 15 }, passwordInput: { color: C.text, flex: 1, fontSize: 16, height: '100%', paddingHorizontal: 15 }, toggle: { color: C.blue, fontSize: 11, fontWeight: '800' }, inputError: { borderColor: C.red }, error: { color: C.red, fontSize: 12, marginTop: 6 }, authError: { color: C.red, fontSize: 13, fontWeight: '600', marginTop: 16, textAlign: 'center' }, loginButton: { alignItems: 'center', backgroundColor: C.blue, borderRadius: 10, height: 52, justifyContent: 'center', marginTop: 24 }, disabled: { backgroundColor: '#94A3B8' }, buttonText: { color: 'white', fontSize: 16, fontWeight: '800' }, hint: { color: '#9DAAC1', fontSize: 12, marginTop: 20, textAlign: 'center' },
  appScreen: { backgroundColor: C.bg, flex: 1 }, topbar: { alignItems: 'center', backgroundColor: 'white', borderBottomColor: '#E7EAF0', borderBottomWidth: 1, flexDirection: 'row', height: 58, justifyContent: 'space-between', paddingHorizontal: 14 }, menuButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 }, menuIcon: { color: C.navy, fontSize: 25 }, topbarTitle: { color: C.navy, flex: 1, fontSize: 17, fontWeight: '800', marginLeft: 8 }, bellButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 }, bellIcon: { color: C.navy, fontSize: 22 }, notificationDot: { alignItems: 'center', backgroundColor: C.red, borderRadius: 9, minHeight: 17, minWidth: 17, paddingHorizontal: 3, position: 'absolute', right: 1, top: 2 }, notificationBadgeText: { color: 'white', fontSize: 8, fontWeight: '900' }, dashboard: { gap: 16, padding: 18, paddingBottom: 36 }, headerRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'space-between' }, headerCopy: { flex: 1 }, eyebrow: { color: C.blue, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, greeting: { color: C.text, fontSize: 27, fontWeight: '900', marginTop: 4 }, intro: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 4 }, emergencyButton: { borderColor: C.red, borderRadius: 8, borderWidth: 1.3, paddingHorizontal: 10, paddingVertical: 9 }, emergencyText: { color: C.red, fontSize: 11, fontWeight: '800' }, errorCard: { backgroundColor: '#FDEBEC', borderRadius: 8, padding: 12 }, errorCardText: { color: C.red, fontSize: 12, fontWeight: '700' }, retryText: { color: C.blue, fontSize: 11, marginTop: 4 }, card: { ...shadow, backgroundColor: 'white', borderRadius: 12, padding: 18 }, cardHeader: { flexDirection: 'row', justifyContent: 'space-between' }, sectionLabel: { color: '#5C6678', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 }, dots: { color: '#8B94A4', fontSize: 22, lineHeight: 22 }, attendanceMenu: { alignSelf: 'flex-end', backgroundColor: 'white', borderColor: '#DDE3EB', borderRadius: 10, borderWidth: 1, elevation: 6, marginTop: 6, minWidth: 220, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: .14, shadowRadius: 7 }, attendanceMenuItem: { alignItems: 'center', borderBottomColor: '#EDF0F4', borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 11 }, attendanceMenuIcon: { alignItems: 'center', borderRadius: 9, height: 34, justifyContent: 'center', width: 34 }, leaveMenuIcon: { backgroundColor: '#EAF2FF' }, lateMenuIcon: { backgroundColor: '#FFF1DF' }, leaveMenuIconText: { color: C.blue, fontSize: 13, fontWeight: '900' }, lateMenuIconText: { color: C.orange, fontSize: 18, fontWeight: '900' }, attendanceMenuCopy: { flex: 1 }, attendanceMenuText: { color: C.text, fontSize: 12, fontWeight: '800' }, attendanceMenuHint: { color: '#7D8796', fontSize: 9, marginTop: 2 }, leaveForm: { backgroundColor: '#F7F9FC', borderColor: '#DCE3EC', borderRadius: 8, borderWidth: 1, marginTop: 10, padding: 10 }, leaveReasonInput: { backgroundColor: 'white', borderColor: '#C8D0DB', borderRadius: 7, borderWidth: 1, color: C.text, fontSize: 12, minHeight: 70, padding: 10 }, leaveActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 9 }, leaveCancel: { alignItems: 'center', borderColor: '#AAB3C0', borderRadius: 6, borderWidth: 1, justifyContent: 'center', minHeight: 34, paddingHorizontal: 14 }, leaveCancelText: { color: C.muted, fontSize: 11, fontWeight: '800' }, leaveSubmit: { alignItems: 'center', backgroundColor: C.blue, borderRadius: 6, justifyContent: 'center', minHeight: 34, minWidth: 78, paddingHorizontal: 14 }, attendanceIcon: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#E5F7F0', borderRadius: 24, height: 48, justifyContent: 'center', marginTop: 12, width: 48 }, shiftTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 10, textAlign: 'center' }, shiftSub: { color: C.muted, fontSize: 12, marginTop: 5, textAlign: 'center' }, attendanceButton: { alignItems: 'center', backgroundColor: C.blue, borderRadius: 8, height: 46, justifyContent: 'center', marginTop: 18 }, checkoutButton: { backgroundColor: '#FFF5F5', borderColor: C.red, borderWidth: 1 }, attendanceButtonText: { color: 'white', fontSize: 14, fontWeight: '900' }, timeRow: { alignItems: 'center', backgroundColor: '#F7F8FB', borderRadius: 9, flexDirection: 'row', marginTop: 18, paddingVertical: 12 }, timeBox: { alignItems: 'center', flex: 1 }, timeLabel: { color: '#8B94A4', fontSize: 9, fontWeight: '800', letterSpacing: 1 }, timeValue: { color: C.text, fontSize: 14, fontWeight: '800', marginTop: 3 }, separator: { backgroundColor: '#DDE2EA', height: 30, width: 1 }, activeTitle: { color: C.text, fontSize: 20, fontWeight: '900' }, activeSub: { color: C.muted, fontSize: 12, marginTop: 4 }, taskList: { marginHorizontal: -18, marginTop: 12 }, taskRow: { borderBottomColor: '#E8EBF0', borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingVertical: 15 }, taskMain: { flex: 1 }, taskName: { color: C.text, fontSize: 13, fontWeight: '800', lineHeight: 18 }, taskArea: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 4 }, progressTrack: { backgroundColor: '#E8EDF7', borderRadius: 3, height: 4, marginTop: 9, overflow: 'hidden' }, progressFill: { backgroundColor: C.blue, borderRadius: 3, height: '100%' }, taskMeta: { alignItems: 'flex-end', width: 83 }, due: { color: '#687286', fontSize: 9 }, progress: { color: C.blue, fontSize: 11, fontWeight: '900', marginTop: 7 }, pill: { borderRadius: 12, marginTop: 6, paddingHorizontal: 8, paddingVertical: 4 }, pillText: { fontSize: 9, fontWeight: '900' },
  attendanceCenteredLabel: { color: '#5C6678', flex: 1, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, textAlign: 'center' }, centeredCheckIn: { alignItems: 'center', alignSelf: 'center', backgroundColor: C.blue, borderRadius: 9, justifyContent: 'center', marginTop: 22, minHeight: 48, paddingHorizontal: 44 }, checkedInTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 18, textAlign: 'center' }, attendanceExpanded: { overflow: 'hidden' }, attendanceTaskHeading: { color: '#657187', fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 17 }, attendanceTaskRow: { backgroundColor: '#F5F8FC', borderColor: '#DDE4EE', borderRadius: 7, borderWidth: 1, marginTop: 7, padding: 9 }, attendanceTaskName: { color: C.text, fontSize: 10, fontWeight: '800' }, attendanceTaskMeta: { color: C.muted, fontSize: 9, marginTop: 4 }, attendanceEmptyTask: { color: '#7A8496', fontSize: 10, fontStyle: 'italic', marginTop: 7 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7,14,28,.48)', zIndex: 5 }, drawer: { backgroundColor: '#193655', bottom: 0, left: 0, position: 'absolute', top: 0, width: 300, zIndex: 6 }, drawerBrand: { justifyContent: 'center', height: 68, paddingHorizontal: 15 }, drawerLogo: { color: 'white', fontSize: 17, fontWeight: '900' }, drawerSubtitle: { color: '#D4E7FF', fontSize: 8, fontWeight: '800', marginTop: 4 }, activeNav: { alignItems: 'center', backgroundColor: '#2D82EC', flexDirection: 'row', gap: 12, paddingHorizontal: 15, paddingVertical: 14 }, navIcon: { color: 'white', fontSize: 17 }, navText: { color: 'white', fontSize: 14, fontWeight: '800' }, drawerSpacer: { flex: 1 }, safetyCard: { alignItems: 'center', backgroundColor: '#294665', borderColor: '#4E6985', borderRadius: 6, borderWidth: 1, flexDirection: 'row', gap: 12, marginHorizontal: 8, marginBottom: 12, padding: 12 }, shield: { color: '#F3D228', fontSize: 25 }, safetyTitle: { color: 'white', fontSize: 11, fontWeight: '800' }, safetyGreen: { color: '#45DF9A', fontSize: 10, fontWeight: '700', marginTop: 2 }, safetyCaption: { color: '#D1DEEC', fontSize: 9, marginTop: 3 }, employeeCard: { alignItems: 'center', backgroundColor: '#0E1D35', borderRadius: 11, flexDirection: 'row', gap: 11, marginBottom: 10, marginHorizontal: 8, padding: 10 }, avatar: { alignItems: 'center', backgroundColor: '#E4ECF8', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, avatarText: { color: C.blue, fontSize: 17 }, employeeName: { color: 'white', fontSize: 12, fontWeight: '800' }, employeeRole: { color: '#9CC2F3', fontSize: 9, marginTop: 6 }, logout: { color: '#AFC0DA', fontSize: 20 },
  modalBackdrop: { backgroundColor: 'rgba(7,14,28,.56)', flex: 1, justifyContent: 'flex-end' }, sheet: { backgroundColor: 'white', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: Platform.OS === 'ios' ? 30 : 20, paddingHorizontal: 22, paddingTop: 10 }, handle: { alignSelf: 'center', backgroundColor: '#D5D9E1', borderRadius: 3, height: 4, marginBottom: 12, width: 44 }, warningCircle: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#FDEBEC', borderRadius: 28, height: 56, justifyContent: 'center', width: 56 }, modalTitle: { color: C.text, fontSize: 22, fontWeight: '900', marginTop: 10, textAlign: 'center' }, modalCopy: { color: C.muted, fontSize: 12, lineHeight: 18, marginHorizontal: 8, marginTop: 6, textAlign: 'center' }, contactHeading: { color: '#727C8D', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginTop: 18 }, contact: { alignItems: 'center', borderBottomColor: '#E8EBF0', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11 }, contactName: { color: C.text, fontSize: 13, fontWeight: '700' }, phone: { color: C.blue, fontSize: 13, fontWeight: '800' }, closeButton: { alignItems: 'center', backgroundColor: C.red, borderRadius: 9, height: 48, justifyContent: 'center', marginTop: 18 }, notificationBackdrop: { backgroundColor: 'rgba(7,14,28,.42)', flex: 1, paddingHorizontal: 14, paddingTop: Platform.OS === 'android' ? 80 : 60 }, notificationPanel: { ...shadow, alignSelf: 'flex-end', backgroundColor: 'white', borderRadius: 12, maxHeight: '72%', padding: 15, width: '94%' }, notificationHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, notificationTitle: { color: C.text, fontSize: 18, fontWeight: '900' }, newBadge: { backgroundColor: '#EAF2FF', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 }, newBadgeText: { color: C.blue, fontSize: 10, fontWeight: '900' }, notificationList: { marginTop: 8 }, notificationCard: { borderBottomColor: '#E4E8EF', borderBottomWidth: 1, paddingVertical: 12 }, notificationCategory: { color: C.text, fontSize: 13, fontWeight: '900' }, notificationMessage: { color: C.blue, fontSize: 11, lineHeight: 17, marginTop: 4 }, notificationTime: { color: '#8993A4', fontSize: 9, marginTop: 5 }, notificationClose: { alignItems: 'center', borderColor: C.blue, borderRadius: 7, borderWidth: 1, marginTop: 12, padding: 9 },
  detailScreen: { backgroundColor: 'white', flex: 1 }, detailTop: { alignItems: 'center', borderBottomColor: '#E7EAF0', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 13 }, detailTopTitle: { color: C.navy, fontSize: 16, fontWeight: '800' }, detailClose: { color: C.text, fontSize: 28, fontWeight: '700' }, detailContent: { padding: 18, paddingBottom: 42 }, detailTitle: { color: C.text, fontSize: 19, fontWeight: '900' }, detailId: { color: C.blue, fontSize: 11, fontWeight: '800', marginTop: 4 }, summary: { backgroundColor: '#F5F8FC', borderColor: '#D9E1EC', borderRadius: 12, borderWidth: 1, flexDirection: 'row', marginTop: 12, paddingVertical: 15 }, summaryCell: { flex: 1, paddingHorizontal: 9 }, summaryDivider: { backgroundColor: '#D5DDE8', width: 1 }, summaryLabel: { color: '#718096', fontSize: 9, fontWeight: '900' }, summaryValue: { color: C.text, fontSize: 11, fontWeight: '800', marginTop: 4 }, taskDescription: { color: C.muted, fontSize: 11, marginTop: 14 }, detailActions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }, detailDue: { color: C.muted, fontSize: 9, marginTop: 5 }, outlineButton: { alignItems: 'center', borderColor: C.blue, borderRadius: 7, borderWidth: 1, justifyContent: 'center', minHeight: 34, paddingHorizontal: 13 }, outlineButtonText: { color: C.blue, fontSize: 11, fontWeight: '900' }, workLogTitle: { color: C.text, fontSize: 17, fontWeight: '900', marginTop: 22 }, logForm: { borderColor: C.blue, borderRadius: 7, borderWidth: 1, marginTop: 12, padding: 12 }, formTitle: { color: '#1543A7', fontSize: 13, fontWeight: '900' }, entryInfo: { backgroundColor: '#F1F5F9', borderColor: '#D9E1EC', borderRadius: 11, borderWidth: 1, flexDirection: 'row', marginTop: 14, padding: 12 }, entryCell: { flex: 1 }, formInput: { borderColor: '#C6CCD5', borderRadius: 7, borderWidth: 1, color: C.text, fontSize: 12, height: 42, marginTop: 12, paddingHorizontal: 10 }, formLabel: { color: '#465267', fontSize: 10, fontWeight: '900', marginTop: 13 }, textarea: { borderColor: C.text, borderRadius: 7, borderWidth: 1, color: C.text, fontSize: 12, height: 82, marginTop: 7, padding: 10 }, gpsRow: { alignItems: 'center', flexDirection: 'row', gap: 6 }, gpsInput: { flex: 1 }, locateButton: { alignItems: 'center', backgroundColor: '#EAF2FF', borderRadius: 20, height: 38, justifyContent: 'center', marginTop: 12, width: 38 }, locateIcon: { color: C.blue, fontSize: 17 }, equipmentBox: { backgroundColor: '#F5F8FC', borderColor: '#D9E1EC', borderRadius: 10, borderWidth: 1, marginTop: 12, padding: 12 }, equipmentItem: { color: C.text, fontSize: 11, marginTop: 7 }, equipmentRow: { alignItems: 'center', flexDirection: 'row', gap: 8 }, equipmentInput: { flex: 1 }, removeEquipment: { color: C.red, fontSize: 22, marginTop: 10 }, addEquipment: { alignSelf: 'flex-start', borderColor: C.blue, borderRadius: 6, borderWidth: 1, marginTop: 9, padding: 8 }, addEquipmentText: { color: C.blue, fontSize: 10, fontWeight: '900' }, machineryCode: { color: '#7A8496', fontSize: 8, marginTop: 3 }, machinerySectionTitle: { color: C.text, fontSize: 14, fontWeight: '900' }, addMachineryPrimary: { alignItems: 'center', borderColor: C.blue, borderRadius: 7, borderStyle: 'dashed', borderWidth: 1, marginTop: 12, padding: 11 }, machineryEntryForm: { borderTopColor: '#DCE3EC', borderTopWidth: 1, marginTop: 12, paddingTop: 2 }, machinerySelect: { backgroundColor: 'white', borderColor: '#BFC8D5', borderRadius: 7, borderWidth: 1, justifyContent: 'center', marginTop: 6, minHeight: 42, paddingHorizontal: 10 }, machinerySelectPlaceholder: { color: '#7A8496', fontSize: 11 }, machinerySelectValue: { color: C.text, fontSize: 11, fontWeight: '700' }, machineryEntryQuantity: { backgroundColor: 'white', borderColor: '#BFC8D5', borderRadius: 7, borderWidth: 1, color: C.text, fontSize: 13, height: 40, marginTop: 6, paddingHorizontal: 10, width: 90 }, machineryAddButton: { alignItems: 'center', alignSelf: 'flex-end', backgroundColor: C.blue, borderRadius: 7, justifyContent: 'center', marginTop: 12, minHeight: 38, paddingHorizontal: 24 }, addedMachinery: { borderTopColor: '#DCE3EC', borderTopWidth: 1, marginTop: 14, paddingTop: 10 }, addedMachineryTitle: { color: C.text, fontSize: 12, fontWeight: '900', marginBottom: 5 }, addedMachineryRow: { alignItems: 'center', borderBottomColor: '#E0E6EE', borderBottomWidth: 1, flexDirection: 'row', gap: 7, paddingVertical: 9 }, addedMachineryCheck: { color: C.green, fontSize: 13, fontWeight: '900' }, addedMachineryName: { color: C.text, flex: 1, fontSize: 10, fontWeight: '700' }, addedMachineryQty: { color: C.muted, fontSize: 10, fontWeight: '800' }, machineryEdit: { color: C.blue, fontSize: 16, paddingHorizontal: 3 }, machineryDelete: { color: C.red, fontSize: 17, paddingHorizontal: 3 }, addAnotherMachinery: { alignItems: 'center', borderColor: C.blue, borderRadius: 7, borderStyle: 'dashed', borderWidth: 1, marginTop: 12, padding: 9 }, machinerySaveButton: { alignItems: 'center', backgroundColor: C.blue, borderRadius: 7, marginTop: 10, padding: 10 }, pickerBackdrop: { backgroundColor: 'rgba(7,14,28,.5)', flex: 1, justifyContent: 'center', padding: 24 }, pickerCard: { backgroundColor: 'white', borderRadius: 12, maxHeight: '70%', padding: 16 }, pickerTitle: { color: C.text, fontSize: 17, fontWeight: '900' }, pickerSearch: { borderColor: '#C5CDD8', borderRadius: 7, borderWidth: 1, height: 42, marginTop: 12, paddingHorizontal: 10 }, pickerList: { marginTop: 8 }, pickerOption: { borderBottomColor: '#E2E7EE', borderBottomWidth: 1, paddingVertical: 12 }, pickerOptionName: { color: C.text, fontSize: 12, fontWeight: '800' }, formActions: { flexDirection: 'row', gap: 12, marginTop: 16 }, submitButton: { alignItems: 'center', backgroundColor: C.blue, borderRadius: 7, justifyContent: 'center', minHeight: 38, paddingHorizontal: 14 }, submitDisabled: { backgroundColor: '#9FB7EB' }, historyHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 }, historyActions: { flexDirection: 'row', gap: 7 }, emptyHistory: { color: '#7A8496', fontSize: 11, fontStyle: 'italic', marginTop: 15 }, historyCard: { backgroundColor: 'white', borderColor: '#E0E5EC', borderRadius: 9, borderWidth: 1, marginTop: 10, padding: 12 }, historyRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, historyDate: { color: C.text, fontSize: 12, fontWeight: '800' }, historyFieldLabel: { color: '#7A8496', fontSize: 9, fontWeight: '800', marginTop: 10 }, historyQty: { color: C.text, fontSize: 12, fontWeight: '900', marginTop: 3 }, historyDescriptionBox: { backgroundColor: '#F2F5F8', borderRadius: 6, marginTop: 5, padding: 9 }, historyDescription: { color: C.muted, fontSize: 11, lineHeight: 17 }, historyDivider: { backgroundColor: '#E2E6EC', height: 1, marginVertical: 10 }, requestEditButton: { alignSelf: 'flex-start', borderColor: '#B6BFCC', borderRadius: 13, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 }, requestEdit: { color: C.blue, fontSize: 10, fontWeight: '800' },
});
