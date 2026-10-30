import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production';

export interface JWTPayload {
  userId: string;
  email: string;
  username: string;
  type: 'access' | 'refresh';
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
  };
}

export function generateAccessToken(user: { id: string; email: string; username: string }): string {
  return jwt.sign(
    { userId: user.id, email: user.email, username: user.username, type: 'access' },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

export function generateRefreshToken(user: { id: string; email: string; username: string }): string {
  return jwt.sign(
    { userId: user.id, email: user.email, username: user.username, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: '30d' }
  );
}

export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const payload = verifyAccessToken(token);
  if (!payload || payload.type !== 'access') {
    return res.status(403).json({ error: 'Invalid or expired access token' });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, username: true },
  });

  if (!user) {
    return res.status(403).json({ error: 'User not found' });
  }

  req.user = user;
  next();
}

export async function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return next();
  }

  const payload = verifyAccessToken(token);
  if (!payload || payload.type !== 'access') {
    return next();
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, username: true },
  });

  if (user) {
    req.user = user;
  }
  next();
}

export function generateTokens(user: { id: string; email: string; username: string }) {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user),
  };
}

export function setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
  const isProd = process.env.NODE_ENV === 'production';

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/',
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  });
}

export function clearTokenCookies(res: Response) {
  const isProd = process.env.NODE_ENV === 'production';

  res.clearCookie('access_token', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  });

  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  });
}