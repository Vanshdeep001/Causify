// =============================================
// Winston Logger Configuration
// =============================================
// Structured logging with different transports
// for development (console) and production (file).
// =============================================

import winston from 'winston';
import path from 'path';
import { env } from './env';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom format for development console output
const devFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
});

// Create logger
const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true })
  ),
  defaultMeta: { service: 'shopverse-api' },
  transports: [],
  exitOnError: false,
});

// Development: colorized console output
if (env.NODE_ENV === 'development') {
  logger.add(
    new winston.transports.Console({
      format: combine(colorize(), devFormat),
    })
  );
} else {
  // Production: JSON format to files
  logger.add(
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      format: json(),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
  logger.add(
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      format: json(),
      maxsize: 5242880,
      maxFiles: 10,
    })
  );
  // Also log to console in production (for container stdout)
  logger.add(
    new winston.transports.Console({
      format: combine(json()),
    })
  );
}

export default logger;
