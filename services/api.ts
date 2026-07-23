import * as SecureStore from 'expo-secure-store';

export type SessionUser = {
  UserId: number;
  EmployeeId: number | null;
  Name: string;
  EmployeeName?: string;
  Email: string;
  Role: string;
  Token?: string;
};

export type MobileTask = {
  id: string;
  numericId: number;
  name: string;
  area: string;
  project: string;
  workArea: string;
  due: string;
  progress: number;
  completedQuantity: number;
  plannedQuantity: number;
  unit: string;
  status: string;
};

export type AttendanceRecord = {
  AttendanceId: number;
  EmployeeId: number;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  AttendanceDate: string;
};

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  isRead: boolean;
};

export type MachineryItem = { MachineryId: number; MachineryName: string; MachineryCode: string };

const SESSION_KEY = 'nova.session';
const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:5000/api').replace(/\/$/, '');
let currentSession: SessionUser | null = null;

function headers(json = true) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(currentSession ? {
      ...(currentSession.Token ? { Authorization: `Bearer ${currentSession.Token}` } : {}),
      'x-user-id': String(currentSession.UserId),
      'x-user-role': currentSession.Role,
      ...(currentSession.EmployeeId ? { 'x-employee-id': String(currentSession.EmployeeId) } : {}),
    } : {}),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers(init.body !== undefined), ...(init.headers || {}) } });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Request failed (${response.status})`);
  return data as T;
}

export const api = {
  async restoreSession() {
    const saved = await SecureStore.getItemAsync(SESSION_KEY);
    currentSession = saved ? JSON.parse(saved) : null;
    if (currentSession?.Role === 'Employee' && !currentSession.Token) {
      currentSession = null;
      await SecureStore.deleteItemAsync(SESSION_KEY);
    }
    return currentSession;
  },
  async login(email: string, password: string) {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    currentSession = null;
    const result = await request<{ user: SessionUser; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username: email, password, role: 'Employee' }) });
    const user = { ...result.user, Token: result.token };
    currentSession = user;
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(user));
    return user;
  },
  async logout() {
    try { await request('/auth/logout', { method: 'POST', body: '{}' }); } finally { currentSession = null; await SecureStore.deleteItemAsync(SESSION_KEY); }
  },
  async tasks(): Promise<MobileTask[]> {
    const rows = await request<any[]>('/tasks');
    return rows.map((row) => ({
      id: row.TaskCode || `TSK-${String(row.TaskId).padStart(5, '0')}`,
      numericId: Number(row.TaskId),
      name: row.TaskName,
      project: row.ProjectName || 'Project',
      workArea: row.WorkName || row.SubWorkName || row.DepartmentName || 'Work Area',
      area: `${row.ProjectName || 'Project'} / ${row.WorkName || row.SubWorkName || row.DepartmentName || 'Work Area'}`,
      due: row.FinishDate ? new Date(row.FinishDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No due date',
      progress: Math.round(Number(row.ProgressPercent || 0)),
      completedQuantity: Number(row.CompletedQuantity || 0),
      plannedQuantity: Number(row.PlannedQuantity || 0),
      unit: row.Unit || 'Units',
      status: row.Status || 'Open',
    }));
  },
  async attendanceToday() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const rows = await request<AttendanceRecord[]>(`/attendance?date=${today}`);
    return rows.find((row) => {
      const parsed = new Date(row.AttendanceDate);
      const recordDate = Number.isNaN(parsed.getTime())
        ? String(row.AttendanceDate).slice(0, 10)
        : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      return recordDate === today && Number(row.EmployeeId) === Number(currentSession?.EmployeeId);
    }) || null;
  },
  checkIn: () => request<AttendanceRecord>('/attendance/check-in', { method: 'POST', body: '{}' }),
  checkOut: () => request<AttendanceRecord>('/attendance/check-out', { method: 'POST', body: '{}' }),
  async notifications() { return request<{ unreadCount: number; notifications: NotificationItem[] }>('/notifications'); },
  machinery: () => request<MachineryItem[]>('/site-monitoring/machinery'),
  closeTask: (taskId: number) => request<any>(`/tasks/${taskId}/close`, { method: 'POST', body: JSON.stringify({ remarks: 'Task closed from NOVA+ mobile app' }) }),
  submitProgress: (taskId: number, quantity: string, description: string, machineryUsage: Array<{ machineryId: number; machineryName: string; quantityUsed: number }>) => request<any>('/progress', { method: 'POST', body: JSON.stringify({ taskId, employeeId: currentSession?.EmployeeId, todayQuantity: quantity, remarks: description, machineryUsage }) }),
  requestEdit: (taskId: number, reason: string) => request<any>(`/tasks/${taskId}/reopen-request`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
