import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, generateTokens, setTokenCookies, clearTokenCookies, verifyAccessToken, verifyRefreshToken } from '../middleware/auth.js';
import { registerSchema, loginSchema, refreshTokenSchema } from '../utils/validation.js';

const router = Router();

// Register
router.post('/register', async (req, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: data.email }, { username: data.username }] },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email or username already in use' });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash,
      },
    });

    const tokens = generateTokens({ id: user.id, email: user.email, username: user.username });
    setTokenCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.status(201).json({
      user: { id: user.id, email: user.email, username: user.username },
      ...tokens,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = await bcrypt.compare(data.password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const tokens = generateTokens({ id: user.id, email: user.email, username: user.username });
    setTokenCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.json({
      user: { id: user.id, email: user.email, username: user.username },
      ...tokens,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (_req, res: Response) => {
  clearTokenCookies(res);
  res.json({ success: true });
});

// Refresh token
router.post('/refresh', async (req, res: Response) => {
  try {
    const data = refreshTokenSchema.parse(req.body);
    const payload = verifyRefreshToken(data.refreshToken);

    if (!payload || payload.type !== 'refresh') {
      return res.status(403).json({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, username: true },
    });

    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    const tokens = generateTokens({ id: user.id, email: user.email, username: user.username });
    setTokenCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.json(tokens);
  } catch (error) {
    console.error('Refresh error:', error);
    return res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const accountsResult = await prisma.oAuthAccount.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true,
        provider: true,
        providerUserId: true,
        providerUsername: true,
        avatarUrl: true,
        lastSyncedAt: true,
        syncStatus: true,
        syncError: true,
      },
    });

    return res.json({
      user,
      linkedAccounts: accountsResult,
    });
  } catch (error) {
    console.error('Get me error:', error);
    return res.status(500).json({ error: 'Failed to get user' });
  }
});

// Get auth status (for initial load)
router.get('/status', async (req: any, res: Response) => {
  const accessToken = req.headers.authorization?.split(' ')[1];
  const refreshToken = req.cookies?.refresh_token;

  let user: any = null;

  // Try access token first
  if (accessToken) {
    const payload = verifyAccessToken(accessToken);
    if (payload && payload.type === 'access') {
      const userRecord = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, username: true, displayName: true, avatarUrl: true },
      });
      if (userRecord) user = userRecord;
    }
  }

  // Try refresh token if no access token or invalid
  if (!user && refreshToken) {
    const payload = verifyRefreshToken(refreshToken);
    if (payload && payload.type === 'refresh') {
      const userRecord = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, username: true, displayName: true, avatarUrl: true },
      });
      if (userRecord) user = userRecord;
    }
  }

  if (!user) {
    return res.json({
      isAuthenticated: false,
      user: null,
      linkedAccounts: [],
    });
  }

  const accountsResult = await prisma.oAuthAccount.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      provider: true,
      providerUserId: true,
      providerUsername: true,
      avatarUrl: true,
      lastSyncedAt: true,
      syncStatus: true,
      syncError: true,
    },
  });

  return res.json({
    isAuthenticated: true,
    user,
    linkedAccounts: accountsResult,
  });
});

// Unlink account
router.delete('/accounts/:accountId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { accountId } = req.params;
    const userId = req.user!.id;

    const account = await prisma.oAuthAccount.findUnique({
      where: { id: accountId },
    });

    if (!account || account.userId !== userId) {
      return res.status(404).json({ error: 'Account not found' });
    }

    await prisma.oAuthAccount.delete({ where: { id: accountId } });

    return res.json({ success: true });
  } catch (error) {
    console.error('Unlink account error:', error);
    return res.status(500).json({ error: 'Failed to unlink account' });
  }
});

// Re-authenticate with access token from cookie
router.post('/verify', async function (req: any, res: Response) {
  const accessToken = req.cookies?.access_token;

  if (!accessToken) {
    return res.status(401).json({ error: 'No access token' });
  }

  const payload = verifyAccessToken(accessToken);
  if (!payload || payload.type !== 'access') {
    return res.status(403).json({ error: 'Invalid access token' });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, username: true },
  });

  if (!user) {
    return res.status(403).json({ error: 'User not found' });
  }

  return res.json({ valid: true, user });
});

export { verifyAccessToken, verifyRefreshToken } from '../middleware/auth.js';
export default router;