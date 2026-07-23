import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dashboardRoutes from './routes/dashboard.js';
import clientRoutes from './routes/clients.js';
import projectRoutes from './routes/projects.js';
import subWorkRoutes from './routes/subworks.js';
import employeeRoutes from './routes/employeesV2.js';
import taskRoutes from './routes/tasks.js';
import taskV2Routes from './routes/taskV2.js';
import progressRoutes from './routes/progress.js';
import imageRoutes from './routes/images.js';
import attendanceRoutes from './routes/attendance.js';
import authRoutes from './routes/auth.js';
import departmentRoutes from './routes/departmentsV2.js';
import workItemRoutes from './routes/workitems.js';
import auditRoutes from './routes/audit.js';
import reportsRoutes from './routes/reports.js';
import userRoutes from './routes/usersV2.js';
import leavePermissionRoutes from './routes/leavePermission.js';
import notificationRoutes from './routes/notifications.js';
import siteMonitoringRoutes from './routes/siteMonitoring.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 5000);
const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_ROOT || '../uploads');

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadRoot));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'construction-monitoring-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/subworks', subWorkRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/work-items', workItemRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/task-v2', taskV2Routes);
app.use('/api/progress', progressRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leave-permission', leavePermissionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/site-monitoring', siteMonitoringRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

app.listen(port, () => {
  console.log(`Construction Monitoring API running on http://localhost:${port}`);
});







