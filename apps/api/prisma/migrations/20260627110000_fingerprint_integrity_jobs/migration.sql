-- APPLY_FINGERPRINT (setprop device identifiers) + PROVISION_INTEGRITY (Play
-- Integrity provisioning) job types. Bare ADD VALUE — cannot run in a PL/pgSQL block.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'APPLY_FINGERPRINT';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'PROVISION_INTEGRITY';
