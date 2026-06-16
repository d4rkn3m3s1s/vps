import fs from 'node:fs';
import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';
import YAML from 'yaml';

// docs/openapi.yaml lives at the repo root (apps/api/../../docs). Resolve it
// relative to this source file so it works regardless of the process cwd.
const candidatePaths = [
  path.resolve(process.cwd(), 'docs', 'openapi.yaml'),
  path.resolve(__dirname, '..', '..', '..', 'docs', 'openapi.yaml'),
  path.resolve(__dirname, '..', '..', 'docs', 'openapi.yaml')
];
const openApiPath = candidatePaths.find((p) => fs.existsSync(p)) ?? candidatePaths[0]!;
const rawDocument = fs.readFileSync(openApiPath, 'utf8');
const parsedDocument = YAML.parse(rawDocument);

export const swaggerSpec = swaggerJsdoc({
  definition: parsedDocument,
  apis: []
});
