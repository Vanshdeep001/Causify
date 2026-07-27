// =============================================
// Express Application Setup
// =============================================
// Configures all middleware, security headers,
// and mounts the API router.
// =============================================

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler } from './middleware/error.middleware';
import { generalLimiter } from './middleware/rateLimiter.middleware';
import logger from './config/logger';

import authRoutes from './routes/auth.routes';

const app = express();

// ---- Security Middleware ----

// Helmet: sets various HTTP security headers
app.use(helmet());

// CORS: allow requests from the frontend origin
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true, // allow cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// ---- Parsing Middleware ----

// Parse JSON bodies (limit 10MB for image data URLs)
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Parse cookies
app.use(cookieParser());

// ---- Performance Middleware ----

// Gzip compression
app.use(compression());

// ---- Rate Limiting ----
app.use('/api/', generalLimiter);

// ---- Request Logging ----

// Morgan streams to Winston
const morganStream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

app.use(
  morgan(
    env.NODE_ENV === 'development' ? 'dev' : 'combined',
    { stream: morganStream }
  )
);

// ---- Health Check ----
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'ShopVerse API is running',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ---- API Routes ----
app.use('/api/v1/auth', authRoutes);
// Routes will be mounted here as we build each module:
// app.use('/api/v1/products', productRoutes);
// etc.

// ---- 404 Handler ----
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    statusCode: 404,
    message: 'Route not found',
    timestamp: new Date().toISOString(),
  });
});

// ---- Global Error Handler ----
app.use(errorHandler);

export default app;
