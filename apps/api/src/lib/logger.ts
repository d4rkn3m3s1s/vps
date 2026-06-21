import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import { env } from '../config/env';

const logDir = path.resolve(process.cwd(), 'storage', 'logs');
fs.mkdirSync(logDir, { recursive: true });

export const logger = winston.createLogger({
  level: env.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: env.appName
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const suffix = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level}: ${message}${suffix}`;
        })
      )
    }),
    new winston.transports.File({ filename: path.join(logDir, 'app.log') }),
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' })
  ]
});
