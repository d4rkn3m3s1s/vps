import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { apiRateLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { requestContext } from './middleware/requestContext';
import { opsRequestLogger } from './modules/ops/ops.service';
import { registerRoutes } from './routes';
import { swaggerSpec } from './swagger';

export function createApp() {
  const app = express();

  // ★2026-07-24: trust the loopback proxy (Caddy runs on 127.0.0.1 and forwards here).
  // Without this, Express reads req.ip as Caddy's loopback peer (127.0.0.1) for EVERY
  // request — so rate-limit + brute-force lockout key on ONE IP for all clients. That
  // both spams a ValidationError (X-Forwarded-For set but trust-proxy false) AND lets an
  // attacker fill the 127.0.0.1|email bucket to lock out the real operator (self-DoS).
  // 'loopback' is the narrowest safe setting: trust ONLY the local Caddy hop, so a client
  // can't spoof X-Forwarded-For to forge its IP (a bare `true`/`1` would be spoofable).
  app.set('trust proxy', 'loopback');

  app.disable('x-powered-by');
  app.use(requestContext);
  // ★2026-08-18 Canli operasyon akisi: her istegi bellek halka tamponuna yazar +
  // panele WS ile iter. requestContext'ten HEMEN SONRA: requestId hazir olsun ve
  // helmet/cors/body-parser dahil TUM surenin olculmesi icin en dista dursun.
  app.use(opsRequestLogger);
  app.use(helmet());
  app.use(cors({ origin: [env.webBaseUrl], credentials: true }));
  app.use(compression());
  // Stripe's webhook needs the raw body for signature verification, so skip the
  // JSON body parser for that one path (its route mounts express.raw()).
  app.use((req, res, next) => {
    if (req.originalUrl === '/billing/webhook') return next();
    return express.json({ limit: '10mb' })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true }));
  app.use(apiRateLimiter);

  app.get('/', (_req, res) => {
    res.json({
      name: env.appName,
      version: '1.0.0',
      docs: '/docs'
    });
  });

  app.get('/docs.json', (_req, res) => {
    res.json(swaggerSpec);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  registerRoutes(app);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
