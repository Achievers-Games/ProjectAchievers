import axios from 'axios';
import { prisma } from '../index.js';
import { generatePkceChallenge, generateState } from '../utils/oauth.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_OAUTH_BASE = 'https://discord.com/oauth2';

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI!;
const DISCORD_SCOPES = process.env.DISCORD_SCOPES || 'identify email';

interface DiscordTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name: string | null;
  avatar: string | null;
  email?: string;
  verified?: boolean;
  locale?: string;
}

function getClient() {
  return axios.create({
    baseURL: DISCORD_API_BASE,
    timeout: 10000,
  });
}

function getOAuthClient() {
  return axios.create({
    baseURL: DISCORD_OAUTH_BASE,
    timeout: 10000,
  });
}

export async function generateDiscordOAuthUrl(state: string, codeVerifier: string): Promise<string> {
  const codeChallenge = await generatePkceChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: DISCORD_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  });

  return `${DISCORD_OAUTH_BASE}/authorize?${params.toString()}`;
}

export async function exchangeDiscordCodeForTokens(code: string, codeVerifier: string): Promise<DiscordTokens> {
  const response = await getOAuthClient().post('/token', new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    redirect_uri: DISCORD_REDIRECT_URI,
    code_verifier: codeVerifier,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return response.data;
}

export async function refreshDiscordTokens(refreshToken: string): Promise<DiscordTokens> {
  const response = await getOAuthClient().post('/token', new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return response.data;
}

export async function revokeDiscordToken(accessToken: string): Promise<void> {
  try {
    await getOAuthClient().post('/token/revoke', new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      token: accessToken,
      token_type_hint: 'access_token',
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  } catch (error) {
    console.warn('Failed to revoke Discord token:', error);
  }
}

export async function getDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await axios.get(`${DISCORD_API_BASE}/users/@me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 10000,
  });

  return response.data;
}

export async function getDiscordGuilds(accessToken: string): Promise<any[]> {
  const response = await axios.get(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 10000,
  });

  return response.data;
}