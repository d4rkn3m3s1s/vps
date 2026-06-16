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
import { registerRoutes } from './routes';
import { swaggerSpec } from './swagger';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: [env.webBaseUrl], credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
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
