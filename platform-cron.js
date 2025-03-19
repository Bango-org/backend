"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runManualUpdate = void 0;
// weekly-trade-stats.ts
var cron = require("node-cron");
var client_1 = require("@prisma/client");
var dotenv = require("dotenv");
dotenv.config();
// Initialize Prisma client
var prisma = new client_1.PrismaClient();
// Error handling wrapper for async functions
var handleError = function (fn) {
    return function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return __awaiter(void 0, void 0, void 0, function () {
            var error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 4]);
                        return [4 /*yield*/, fn.apply(void 0, args)];
                    case 1: return [2 /*return*/, _a.sent()];
                    case 2:
                        error_1 = _a.sent();
                        console.error("Error in cron job: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)));
                        // Log to monitoring service or send alert if needed
                        // sendAlert(error);
                        // Ensure Prisma connection is closed on error
                        return [4 /*yield*/, prisma.$disconnect()];
                    case 3:
                        // Log to monitoring service or send alert if needed
                        // sendAlert(error);
                        // Ensure Prisma connection is closed on error
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
};
// Main cron job function
var updateDailyTradeStats = function () { return __awaiter(void 0, void 0, void 0, function () {
    var tradeCount, userCount, eventCount, totalTradeAmount, resp, data, addressBalance, statsId, dailyActiveUsers, DAU, monthlyActiveUsers, MAU;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.log("[".concat(new Date().toISOString(), "] Starting weekly trade stats update..."));
                return [4 /*yield*/, prisma.trade.count()];
            case 1:
                tradeCount = _a.sent();
                return [4 /*yield*/, prisma.user.count()];
            case 2:
                userCount = _a.sent();
                return [4 /*yield*/, prisma.event.count()];
            case 3:
                eventCount = _a.sent();
                return [4 /*yield*/, prisma.trade.aggregate({
                        _sum: { amount: true },
                        where: {
                            createdAt: {
                                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Past 7 days
                            }
                        }
                    })];
            case 4:
                totalTradeAmount = _a.sent();
                return [4 /*yield*/, fetch("https://node202.fmt.mempool.space/testnet4/api/address/tb1pd0epx6sjty2xd2ukxmj5j59a3nykuggkkqqsm28x5uweev6s7peqr32gvq")];
            case 5:
                resp = _a.sent();
                return [4 /*yield*/, resp.json()];
            case 6:
                data = _a.sent();
                addressBalance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) + (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum);
                return [4 /*yield*/, prisma.platformStats.findFirst()];
            case 7:
                statsId = _a.sent();
                if (!!statsId) return [3 /*break*/, 9];
                // Create empty record if doesnt exists
                return [4 /*yield*/, prisma.platformStats.create({
                        data: {}
                    })];
            case 8:
                // Create empty record if doesnt exists
                _a.sent();
                _a.label = 9;
            case 9: return [4 /*yield*/, prisma.trade.findMany({
                    where: {
                        createdAt: {
                            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                        },
                        userID: {
                            not: null // Ensure we only count trades with a valid userID
                        }
                    },
                    select: {
                        userID: true
                    },
                    distinct: ['userID']
                })];
            case 10:
                dailyActiveUsers = _a.sent();
                DAU = dailyActiveUsers.length;
                return [4 /*yield*/, prisma.trade.findMany({
                        where: {
                            createdAt: {
                                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                            },
                            userID: {
                                not: null // Ensure we only count trades with a valid userID
                            }
                        },
                        select: {
                            userID: true
                        },
                        distinct: ['userID']
                    })];
            case 11:
                monthlyActiveUsers = _a.sent();
                MAU = monthlyActiveUsers.length;
                return [4 /*yield*/, prisma.platformStats.updateMany({
                        where: {
                            id: statsId === null || statsId === void 0 ? void 0 : statsId.id
                        },
                        data: {
                            tradeCount: tradeCount,
                            userCount: userCount,
                            eventCount: eventCount,
                            totalAmountTraded: parseInt((totalTradeAmount._sum.amount || 0).toString()),
                            totalValueLocked: BigInt(addressBalance),
                            dailyActiveUsers: DAU,
                            monthlyActiveUsers: MAU
                        },
                    })];
            case 12:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); };
// Schedule the cron job to run every Sunday at midnight
cron.schedule("0 0 * * *", handleError(updateDailyTradeStats), {
    timezone: "UTC" // Specify timezone if needed
});
// Also expose a function to run the job manually if needed
exports.runManualUpdate = handleError(updateDailyTradeStats);
console.log("Weekly trade stats cron job scheduled to run every Sunday at midnight (UTC).");
// Handle termination signals for clean shutdown
process.on('SIGTERM', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.log('SIGTERM received, shutting down gracefully');
                return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                process.exit(0);
                return [2 /*return*/];
        }
    });
}); });
process.on('SIGINT', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.log('SIGINT received, shutting down gracefully');
                return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                process.exit(0);
                return [2 /*return*/];
        }
    });
}); });
