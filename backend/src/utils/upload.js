import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_ROOT || '../uploads');

function cleanPart(value, fallback) {
  return String(value || fallback)
    .replace(/[^a-z0-9-_ ]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const project = cleanPart(req.body.projectName || req.params.projectId || req.body.projectId, 'Project');
    const task = cleanPart(req.body.taskName || req.params.taskId || req.body.taskId, 'Task');
    const category = cleanPart(req.body.category || req.uploadCategory || 'Reference', 'Reference');
    const destination = path.join(uploadRoot, 'Projects', project, task, category);
    fs.mkdirSync(destination, { recursive: true });
    cb(null, destination);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = cleanPart(path.basename(file.originalname, ext), 'file');
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

export const upload = multer({ storage });

export function toRelativeUploadPath(filePath) {
  const relative = path.relative(uploadRoot, filePath).replace(/\\/g, '/');
  return `/uploads/${relative}`;
}

