import { PrismaClient } from '@prisma/client';
import { globals } from './globals';

export const db = globals.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globals.prisma = db;
