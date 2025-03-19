-- CreateTable
CREATE TABLE "PlatformStats" (
    "id" SERIAL NOT NULL,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "userCount" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmountTraded" INTEGER NOT NULL DEFAULT 0,
    "totalValueLocked" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformStats_pkey" PRIMARY KEY ("id")
);
