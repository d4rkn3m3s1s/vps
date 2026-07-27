-- PROXY_CREDIT_LOW AlertTrigger: thordata hesabı kalan trafiği (GB) eşik altına düştü.
ALTER TYPE "AlertTrigger" ADD VALUE IF NOT EXISTS 'PROXY_CREDIT_LOW';
