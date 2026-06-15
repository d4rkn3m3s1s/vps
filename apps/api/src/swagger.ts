import fs from 'node:fs';
import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';
import YAML from 'yaml';

const openApiPath = path.resolve(process.cwd(), 'docs', 'openapi.yaml');
const rawDocument = fs.readFileSync(openApiPath, 'utf8');
const parsedDocument = YAML.parse(rawDocument);

export const swaggerSpec = swaggerJsdoc({
  definition: parsedDocument,
  apis: []
});
