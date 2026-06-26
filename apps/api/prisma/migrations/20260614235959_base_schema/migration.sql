-- Base schema (idempotent). Auto-derived from schema.prisma via `prisma migrate diff`,
-- then made idempotent so it can run before the pre-existing partial migrations.
-- Every object is guarded (IF NOT EXISTS / duplicate_object) so re-running, or running
-- against a DB already created via `db push`, is a safe no-op.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EmulatorStatus" AS ENUM ('PENDING', 'RUNNING', 'STOPPED', 'FAILED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "JobType" AS ENUM ('EMULATOR_CREATE', 'EMULATOR_START', 'EMULATOR_STOP', 'EMULATOR_DELETE', 'EMULATOR_INSTALL_APK', 'EMULATOR_SCREENSHOT', 'EMULATOR_SHELL', 'EMULATOR_OPEN_APP', 'EMULATOR_CLOSE_APP', 'EMULATOR_PUSH_FILE', 'EMULATOR_SET_PROXY', 'RPA_RUN', 'EMULATOR_SNAPSHOT_CREATE', 'EMULATOR_SNAPSHOT_RESTORE', 'EMULATOR_RESET', 'EMULATOR_PULL_FILE', 'EMULATOR_CLIPBOARD_SET', 'EMULATOR_CLIPBOARD_GET');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "HostStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'STARTING', 'STOPPING', 'ERROR', 'UPDATING', 'REBOOTING');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SocialProvider" AS ENUM ('X', 'META', 'INSTAGRAM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ProxyType" AS ENUM ('HTTP', 'HTTPS', 'SOCKS5');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ProxyStatus" AS ENUM ('UNKNOWN', 'OK', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReferralStatus" AS ENUM ('INVITED', 'SIGNED_UP', 'CONVERTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'INCOMPLETE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AlertTrigger" AS ENUM ('JOB_FAILED', 'DEVICE_OFFLINE', 'QUOTA_HIGH', 'HOST_OFFLINE', 'FARM_BAN_RISK');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LibraryAssetType" AS ENUM ('IMAGE', 'VIDEO', 'APK', 'COOKIE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ScheduleRepeat" AS ENUM ('ONCE', 'HOURLY', 'DAILY', 'WEEKLY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ListingCategory" AS ENUM ('TEMPLATE', 'AUTOMATION', 'INTEGRATION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FarmStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WebhookEvent" AS ENUM ('JOB_COMPLETED', 'JOB_FAILED', 'DEVICE_ONLINE', 'DEVICE_OFFLINE', 'QUOTA_HIGH', 'ALERT_FIRED', 'ALL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SnapshotVisibility" AS ENUM ('PRIVATE', 'WORKSPACE', 'PUBLIC');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SnapshotStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GrantAccess" AS ENUM ('VIEW', 'CONTROL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ScheduledPostStatus" AS ENUM ('SCHEDULED', 'POSTING', 'POSTED', 'FAILED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Host" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "region" TEXT,
    "status" "HostStatus" NOT NULL DEFAULT 'OFFLINE',
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "runningPhones" INTEGER NOT NULL DEFAULT 0,
    "cpuCores" INTEGER,
    "memoryGb" INTEGER,
    "kvm" BOOLEAN NOT NULL DEFAULT true,
    "agentKeyHash" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "provider" TEXT,
    "vastInstanceId" TEXT,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "referralCode" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredEmail" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'SIGNED_UP',
    "rewardCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkspaceSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "require2fa" BOOLEAN NOT NULL DEFAULT false,
    "restrictInvites" BOOLEAN NOT NULL DEFAULT true,
    "strongPasswords" BOOLEAN NOT NULL DEFAULT true,
    "sessionExpiryHrs" INTEGER NOT NULL DEFAULT 12,
    "vastApiKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'operator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "AlertTrigger" NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 0,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "webhook" BOOLEAN NOT NULL DEFAULT false,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "fireCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertEvent" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Subscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Emulator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "status" "EmulatorStatus" NOT NULL DEFAULT 'PENDING',
    "containerId" TEXT,
    "adbHost" TEXT,
    "adbPort" INTEGER,
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Emulator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeviceGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Device" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
    "ipAddress" TEXT,
    "adbPort" INTEGER,
    "androidVersion" TEXT,
    "cpuUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memoryUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "diskUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastSeen" TIMESTAMP(3),
    "metadata" JSONB,
    "groupId" TEXT,
    "hostId" TEXT,
    "workspaceId" TEXT,
    "adbExposed" BOOLEAN NOT NULL DEFAULT false,
    "adbPublicHost" TEXT,
    "adbPublicPort" INTEGER,
    "adbAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeviceUsage" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "onlineMinutes" INTEGER NOT NULL DEFAULT 0,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeviceFingerprint" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "androidId" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "macAddress" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "buildNumber" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "dpi" INTEGER NOT NULL,
    "carrier" TEXT NOT NULL,
    "mcc" TEXT NOT NULL,
    "mnc" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "country" TEXT NOT NULL DEFAULT 'US',
    "countryCode" TEXT NOT NULL DEFAULT 'US',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT NOT NULL,
    "emulatorId" TEXT,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "claimedByHostId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "requestId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SocialAccount" (
    "id" TEXT NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "username" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LibraryAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LibraryAssetType" NOT NULL DEFAULT 'OTHER',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Proxy" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "ProxyType" NOT NULL DEFAULT 'HTTP',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "group" TEXT,
    "isp" TEXT,
    "remarks" TEXT,
    "exportIp" TEXT,
    "countryCode" TEXT,
    "status" "ProxyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastCheckedAt" TIMESTAMP(3),
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ScheduledTask" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceId" TEXT,
    "jobType" "JobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "repeat" "ScheduleRepeat" NOT NULL DEFAULT 'ONCE',
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContentMetric" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "provider" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AppCatalogItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Social',
    "shortLabel" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3a4256',
    "iconUrl" TEXT,
    "apkUrl" TEXT,
    "installs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AutomationTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3a4256',
    "jobType" "JobType" NOT NULL DEFAULT 'EMULATOR_OPEN_APP',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MarketplaceListing" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ListingCategory" NOT NULL DEFAULT 'TEMPLATE',
    "icon" TEXT NOT NULL DEFAULT '◈',
    "price" TEXT NOT NULL DEFAULT 'Free',
    "installs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RpaFlow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RpaFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FarmCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "FarmStatus" NOT NULL DEFAULT 'ACTIVE',
    "rpaFlowId" TEXT,
    "groupId" TEXT,
    "minIntervalMin" INTEGER NOT NULL DEFAULT 45,
    "maxIntervalMin" INTEGER NOT NULL DEFAULT 180,
    "maxActionsPerDay" INTEGER NOT NULL DEFAULT 20,
    "activeFromHour" INTEGER NOT NULL DEFAULT 8,
    "activeToHour" INTEGER NOT NULL DEFAULT 23,
    "jitterPct" INTEGER NOT NULL DEFAULT 25,
    "rotateProxy" BOOLEAN NOT NULL DEFAULT false,
    "autoPauseThreshold" INTEGER NOT NULL DEFAULT 40,
    "earlyFlowId" TEXT,
    "midFlowId" TEXT,
    "matureFlowId" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FarmAccount" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "warmupStage" INTEGER NOT NULL DEFAULT 1,
    "daysActive" INTEGER NOT NULL DEFAULT 0,
    "actionsToday" INTEGER NOT NULL DEFAULT 0,
    "totalActions" INTEGER NOT NULL DEFAULT 0,
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pausedReason" TEXT,
    "lastActionAt" TIMESTAMP(3),
    "dayAnchor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskAlertedAt" TIMESTAMP(3),
    "platform" TEXT,
    "username" TEXT,
    "emailAddress" TEXT,
    "passwordEnc" TEXT,
    "emailPasswordEnc" TEXT,
    "totpSecretEnc" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FarmActionLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "flowId" TEXT,
    "flowName" TEXT,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "warmupStage" INTEGER NOT NULL DEFAULT 0,
    "healthAfter" INTEGER,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FarmActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Webhook" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "event" "WebhookEvent" NOT NULL DEFAULT 'ALL',
    "secret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" "WebhookEvent" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProfilePermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "deviceId" TEXT,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canControl" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeviceSnapshot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "artifactRef" TEXT,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "androidVersion" TEXT,
    "metadata" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibility" "SnapshotVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "SnapshotStatus" NOT NULL DEFAULT 'PENDING',
    "installs" INTEGER NOT NULL DEFAULT 0,
    "sourceDeviceId" TEXT,
    "workspaceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeviceGrant" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "grantedToId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "access" "GrantAccess" NOT NULL DEFAULT 'VIEW',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ScheduledPost" (
    "id" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "groupId" TEXT,
    "deviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rpaFlowId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledPostStatus" NOT NULL DEFAULT 'SCHEDULED',
    "postedAt" TIMESTAMP(3),
    "error" TEXT,
    "workspaceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Host_workspaceId_idx" ON "Host"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceSettings_workspaceId_key" ON "WorkspaceSettings"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertRule_workspaceId_idx" ON "AlertRule"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertEvent_workspaceId_idx" ON "AlertEvent"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertEvent_ruleId_idx" ON "AlertEvent"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_workspaceId_key" ON "Subscription"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyPrefix_key" ON "ApiKey"("keyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApiKey_workspaceId_idx" ON "ApiKey"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Emulator_containerId_key" ON "Emulator"("containerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeviceGroup_workspaceId_idx" ON "DeviceGroup"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceGroup_workspaceId_name_key" ON "DeviceGroup"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Device_uuid_key" ON "Device"("uuid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Device_workspaceId_idx" ON "Device"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeviceUsage_workspaceId_day_idx" ON "DeviceUsage"("workspaceId", "day");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceUsage_deviceId_day_key" ON "DeviceUsage"("deviceId", "day");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceFingerprint_deviceId_key" ON "DeviceFingerprint"("deviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Job_workspaceId_idx" ON "Job"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_workspaceId_idx" ON "AuditLog"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SocialAccount_workspaceId_idx" ON "SocialAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SocialAccount_provider_providerAccountId_key" ON "SocialAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LibraryAsset_workspaceId_idx" ON "LibraryAsset"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Proxy_workspaceId_idx" ON "Proxy"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScheduledTask_workspaceId_idx" ON "ScheduledTask"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentMetric_provider_date_idx" ON "ContentMetric"("provider", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AppCatalogItem_packageName_key" ON "AppCatalogItem"("packageName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RpaFlow_workspaceId_idx" ON "RpaFlow"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FarmCampaign_workspaceId_idx" ON "FarmCampaign"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FarmAccount_deviceId_key" ON "FarmAccount"("deviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FarmAccount_workspaceId_idx" ON "FarmAccount"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FarmActionLog_deviceId_idx" ON "FarmActionLog"("deviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FarmActionLog_campaignId_idx" ON "FarmActionLog"("campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FarmActionLog_workspaceId_idx" ON "FarmActionLog"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Webhook_workspaceId_idx" ON "Webhook"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebhookDelivery_webhookId_idx" ON "WebhookDelivery"("webhookId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_idx" ON "WebhookDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePermission_userId_groupId_deviceId_key" ON "ProfilePermission"("userId", "groupId", "deviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeviceSnapshot_workspaceId_idx" ON "DeviceSnapshot"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeviceSnapshot_visibility_idx" ON "DeviceSnapshot"("visibility");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeviceGrant_deviceId_idx" ON "DeviceGrant"("deviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeviceGrant_grantedToId_idx" ON "DeviceGrant"("grantedToId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScheduledPost_workspaceId_idx" ON "ScheduledPost"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScheduledPost_status_scheduledFor_idx" ON "ScheduledPost"("status", "scheduledFor");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Host" ADD CONSTRAINT "Host_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WorkspaceSettings" ADD CONSTRAINT "WorkspaceSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DeviceGroup" ADD CONSTRAINT "DeviceGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Device" ADD CONSTRAINT "Device_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DeviceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Device" ADD CONSTRAINT "Device_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Device" ADD CONSTRAINT "Device_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DeviceUsage" ADD CONSTRAINT "DeviceUsage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DeviceFingerprint" ADD CONSTRAINT "DeviceFingerprint_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Job" ADD CONSTRAINT "Job_emulatorId_fkey" FOREIGN KEY ("emulatorId") REFERENCES "Emulator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Job" ADD CONSTRAINT "Job_claimedByHostId_fkey" FOREIGN KEY ("claimedByHostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LibraryAsset" ADD CONSTRAINT "LibraryAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RpaFlow" ADD CONSTRAINT "RpaFlow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmCampaign" ADD CONSTRAINT "FarmCampaign_rpaFlowId_fkey" FOREIGN KEY ("rpaFlowId") REFERENCES "RpaFlow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmCampaign" ADD CONSTRAINT "FarmCampaign_earlyFlowId_fkey" FOREIGN KEY ("earlyFlowId") REFERENCES "RpaFlow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmCampaign" ADD CONSTRAINT "FarmCampaign_midFlowId_fkey" FOREIGN KEY ("midFlowId") REFERENCES "RpaFlow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmCampaign" ADD CONSTRAINT "FarmCampaign_matureFlowId_fkey" FOREIGN KEY ("matureFlowId") REFERENCES "RpaFlow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmCampaign" ADD CONSTRAINT "FarmCampaign_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DeviceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmCampaign" ADD CONSTRAINT "FarmCampaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmAccount" ADD CONSTRAINT "FarmAccount_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmAccount" ADD CONSTRAINT "FarmAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmActionLog" ADD CONSTRAINT "FarmActionLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "FarmAccount"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FarmActionLog" ADD CONSTRAINT "FarmActionLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "FarmCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DeviceSnapshot" ADD CONSTRAINT "DeviceSnapshot_sourceDeviceId_fkey" FOREIGN KEY ("sourceDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DeviceSnapshot" ADD CONSTRAINT "DeviceSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DeviceGrant" ADD CONSTRAINT "DeviceGrant_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

