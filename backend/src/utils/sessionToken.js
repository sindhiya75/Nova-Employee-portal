import crypto from 'crypto';

const secret = process.env.SESSION_SECRET || 'nova-local-development-session-secret';

function signature(payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueSessionToken(user) {
  const payload = Buffer.from(JSON.stringify({
    userId: Number(user.UserId),
    employeeId: user.EmployeeId ? Number(user.EmployeeId) : null,
    role: user.Role,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifySessionToken(token) {
  if (!token) return null;
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return null;
  const expected = signature(payload);
  if (suppliedSignature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(suppliedSignature), Buffer.from(expected))) return null;
  const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!value.expiresAt || value.expiresAt < Date.now()) return null;
  return value;
}
