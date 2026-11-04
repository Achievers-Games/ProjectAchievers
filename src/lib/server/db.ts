import { globals } from './globals';
import { createPrismaClient } from './prisma';

export const db = globals.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globals.prisma = db;
