-- AlterTable
ALTER TABLE "PlatformStats" ADD COLUMN     "dailyActiveUsers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "monthlyActiveUsers" INTEGER NOT NULL DEFAULT 0;
