"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const env_1 = require("../src/config/env");
const prisma = new client_1.PrismaClient();
async function main() {
    const passwordHash = await bcryptjs_1.default.hash(env_1.env.adminPassword, 12);
    await prisma.user.upsert({
        where: { email: env_1.env.adminEmail },
        update: { passwordHash, role: 'admin' },
        create: {
            email: env_1.env.adminEmail,
            passwordHash,
            role: 'admin'
        }
    });
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
