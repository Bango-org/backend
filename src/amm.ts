import { Prisma, PrismaClient } from '@prisma/client';
import ApiError from './utils/ApiError';
import { StatusCodes } from 'http-status-codes';

const prisma = new PrismaClient();

interface TradeResult {
    shares: number;
    cost: number;
    priceImpacts: PriceImpact[];
}

interface QuoteResult {
    usdAmount: number;
    shares: number;
    pricePerShare: number;
    priceImpact: number;
    totalFee: number;
    afterFees: number;
    newPrice: number;
}

interface PriceImpact {
    outcomeId: number;
    title: string;
    beforePrice: number;
    afterPrice: number;
    impact: number;
}

interface MarketState {
    shares: number[];
    b: number;
    outcomes: any[];
}

class LMSR_AMM {
    private readonly FEE_RATE = 0.02;           
    private readonly INITIAL_LIQUIDITY = 100;   
    private readonly MIN_SHARES = 1;            
    private readonly MAX_PRICE_IMPACT = 0.5;    
    private readonly MAX_SHARE_RATIO = 1000; 

    // Get current market state
    private async getMarketState(eventId: number): Promise<MarketState> {
        const outcomes = await prisma.outcome.findMany({
            where: {
                eventID: eventId
            },
        });

        console.log(eventId)

        const totalLiquidity = outcomes.reduce((sum, o) => sum + o.total_liquidity.toNumber(), 0);
        const b = Math.max(totalLiquidity / outcomes.length, this.INITIAL_LIQUIDITY);
        const shares = outcomes.map(o => Math.max(o.current_supply.toNumber(), this.MIN_SHARES));

        return { shares, b, outcomes };
    }

    // Calculate prices for all outcomes
    private calculatePrices(shares: number[], b: number): number[] {
        // Find maximum share value to prevent overflow
        const maxShare = Math.max(...shares);
        
        // Calculate exp(si/b - smax/b) = exp(si/b)/exp(smax/b) to prevent overflow
        const normalizedExp = shares.map(s => Math.exp((s - maxShare) / b));
        const sumExp = normalizedExp.reduce((sum, exp) => sum + exp, 0);
        return normalizedExp.map(exp => exp / sumExp);
    }

    // Calculate cost for share change
    private calculateCost(oldShares: number[], newShares: number[], b: number): number {
        const maxOldShare = Math.max(...oldShares);
        const maxNewShare = Math.max(...newShares);
        
        // Calculate log sum exp with numerical stability
        const oldSum = Math.log(oldShares.map(s => Math.exp((s - maxOldShare) / b))
            .reduce((sum, exp) => sum + exp, 0)) + maxOldShare / b;
        const newSum = Math.log(newShares.map(s => Math.exp((s - maxNewShare) / b))
            .reduce((sum, exp) => sum + exp, 0)) + maxNewShare / b;
            
        return b * (newSum - oldSum);
    }

    // Calculate price impacts
    private calculatePriceImpacts(
        outcomes: any[],
        pricesBefore: number[],
        pricesAfter: number[]
    ): PriceImpact[] {
        return pricesBefore.map((price, index) => ({
            outcomeId: outcomes[index].id,
            title: outcomes[index].outcome_title,
            beforePrice: price,
            afterPrice: pricesAfter[index],
            impact: ((pricesAfter[index] - price) / price) * 100
        }));
    }

    // Buy shares
    public async buyShares(
        eventId: number,
        outcomeId: number,
        amount: number,
        userId: number
    ): Promise<TradeResult> {
        return await prisma.$transaction(async (tx) => {
            // Validate user and balance
            const user = await tx.user.findUnique({
                where: { id: userId },
                select: { playmoney: true }
            });

            if (!user) throw new ApiError(StatusCodes.NOT_FOUND,'User not found');
            // if (user.playmoney < amount) throw new ApiError(StatusCodes.BAD_REQUEST, 'Insufficient balance');

            // Get market state
            const { shares: currentShares, b, outcomes } = await this.getMarketState(eventId);
            const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
            if (outcomeIndex === -1) throw new ApiError(StatusCodes.NOT_FOUND,'Outcome not found');

            // Calculate current prices
            const pricesBefore = this.calculatePrices(currentShares, b);
            const maxCurrentShare = Math.max(...currentShares);
            const minCurrentShare = Math.min(...currentShares);

            if (maxCurrentShare / minCurrentShare > this.MAX_SHARE_RATIO) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST, 
                    'Market too imbalanced - try a smaller trade'
                );
            }


            // Binary search for optimal shares to buy
            let low = 1;
            let high = Math.min(amount * 100, this.MAX_SHARE_RATIO * minCurrentShare);
            let sharesToBuy = 0;
            let totalCost = 0;
            let newShares = currentShares;
                        
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const testShares = [...currentShares];
                testShares[outcomeIndex] += mid;

                const cost = this.calculateCost(currentShares, testShares, b);
                const withFee = cost * (1 + this.FEE_RATE);

                if (withFee <= amount) {
                    sharesToBuy = mid;
                    totalCost = withFee;
                    newShares = testShares;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }

            if (sharesToBuy === 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Amount too small');

            // Calculate new prices and impacts
            const pricesAfter = this.calculatePrices(newShares, b);
            const priceImpacts = this.calculatePriceImpacts(outcomes, pricesBefore, pricesAfter);

            // Check max price impact
            // if (Math.abs(priceImpacts[outcomeIndex].impact) > this.MAX_PRICE_IMPACT * 100) {
            //     throw new ApiError('Price impact too high');
            // }

            // Update user balance
            // await tx.user.update({
            //     where: { id: userId },
            //     data: { playmoney: { decrement: Math.ceil(totalCost) } }
            // });

            // Update outcome shares and liquidity
            await tx.outcome.update({
                where: { id: outcomeId },
                data: {
                    current_supply: { increment: sharesToBuy },
                    total_liquidity: { increment: Math.ceil(totalCost) }
                }
            });

            // Decrease other outcomes' liquidity proportionally
            const liquidityDecrease = totalCost / (outcomes.length - 1);
            for (const outcome of outcomes) {
                if (outcome.id !== outcomeId) {
                    await tx.outcome.update({
                        where: { id: outcome.id },
                        data: {
                            total_liquidity: {
                                decrement: Math.ceil(liquidityDecrease)
                            }
                        }
                    });
                }
            }

            const priceImpactforOutcome  = priceImpacts.find((impact) => impact.outcomeId === outcomeId);

            // Record trade
            await tx.trade.create({
                data: {
                    order_type: 'BUY',
                    order_size: sharesToBuy,
                    amount: Math.ceil(totalCost),
                    eventID: eventId,
                    userID: userId,
                    outcomeId: outcomeId,
                    afterPrice: priceImpactforOutcome?.afterPrice
                }
            });


            // Update token allocation
            await tx.tokenAllocation.upsert({
                where: {
                    userId_outcomeId: { userId, outcomeId }
                },
                create: {
                    userId,
                    outcomeId,
                    amount: sharesToBuy
                },
                update: {
                    amount: { increment: sharesToBuy }
                }
            });

            return {
                shares: sharesToBuy,
                cost: Math.ceil(totalCost),
                priceImpacts
            };
        });
    }

    // Sell shares
    public async sellShares(
        eventId: number,
        outcomeId: number,
        sharesToSell: number,
        userId: number
    ): Promise<TradeResult> {
        return await prisma.$transaction(async (tx) => {
            // Check user's token allocation
            const allocation = await tx.tokenAllocation.findUnique({
                where: {
                    userId_outcomeId: { userId, outcomeId }
                }
            });

            if (!allocation || allocation.amount.toNumber() < sharesToSell) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'Insufficient shares');
            }

            // Get market state
            const { shares: currentShares, b, outcomes } = await this.getMarketState(eventId);
            const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
            if (outcomeIndex === -1) throw new ApiError(StatusCodes.NOT_FOUND, 'Outcome not found');

            // Calculate current prices
            const pricesBefore = this.calculatePrices(currentShares, b);

            // Calculate new shares and cost
            const newShares = [...currentShares];
            newShares[outcomeIndex] -= sharesToSell;
            const maxNewShare = Math.max(...newShares);
            const minNewShare = Math.min(...newShares)

            if (maxNewShare / minNewShare > this.MAX_SHARE_RATIO) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST, 
                    'Sell would create too much market imbalance'
                );
            }

            // Ensure minimum shares maintained
            if (newShares[outcomeIndex] < this.MIN_SHARES) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'Sell would reduce shares below minimum');
            }

            const returnWithoutFee = this.calculateCost(newShares, currentShares, b);
            const fee = returnWithoutFee * this.FEE_RATE;
            const returnAmount = Math.floor(returnWithoutFee - fee);

            // Calculate new prices and impacts
            const pricesAfter = this.calculatePrices(newShares, b);
            const priceImpacts = this.calculatePriceImpacts(outcomes, pricesBefore, pricesAfter);

            // Check max price impact
            // if (Math.abs(priceImpacts[outcomeIndex].impact) > this.MAX_PRICE_IMPACT * 100) {
            //     throw new ApiError(StatusCodes.BAD_REQUEST, 'Price impact too high');
            // }

            // Update outcome
            await tx.outcome.update({
                where: { id: outcomeId },
                data: {
                    current_supply: { decrement: sharesToSell },
                    total_liquidity: { decrement: returnAmount }
                }
            });

            // Increase other outcomes' liquidity proportionally
            const liquidityIncrease = returnAmount / (outcomes.length - 1);
            for (const outcome of outcomes) {
                if (outcome.id !== outcomeId) {
                    await tx.outcome.update({
                        where: { id: outcome.id },
                        data: {
                            total_liquidity: {
                                increment: Math.floor(liquidityIncrease)
                            }
                        }
                    });
                }
            }

            // Update user balance
            // await tx.user.update({
            //     where: { id: userId },
            //     data: { playmoney: { increment: returnAmount } }
            // });

            // Update token allocation
            await tx.tokenAllocation.update({
                where: {
                    userId_outcomeId: { userId, outcomeId }
                },
                data: { amount: { decrement: sharesToSell } }
            });

            const priceImpactforOutcome  = priceImpacts.find((impact) => impact.outcomeId === outcomeId);

            // Record trade
            await tx.trade.create({
                data: {
                    order_type: 'SELL',
                    order_size: sharesToSell,
                    amount: returnAmount,
                    eventID: eventId,
                    userID: userId,
                    outcomeId: outcomeId,
                    afterPrice: priceImpactforOutcome?.afterPrice
                }
            });

            return {
                shares: sharesToSell,
                cost: returnAmount,
                priceImpacts
            };
        });
    }

    /**
     * Get current market prices and share supplies
     */
    public async getMarketPrices(eventId: number) {
        const { shares, b, outcomes } = await this.getMarketState(eventId);
        const prices = this.calculatePrices(shares, b);

        return outcomes.map((outcome, index) => ({
            outcomeId: outcome.id,
            title: outcome.outcome_title,
            currentPrice: prices[index],
            priceInUsd: prices[index],
            currentSupply: outcome.current_supply,
            totalLiquidity: outcome.total_liquidity,
            impliedProbability: prices[index] * 100
        }));
    }

    /**
     * Quote USD to Shares conversion
     * Given a USD amount, calculate how many shares you would receive
     */
    public async quoteUsdToShares(
        eventId: number,
        outcomeId: number,
        usdAmount: number
    ): Promise<QuoteResult> {
        const { shares: currentShares, b, outcomes } = await this.getMarketState(eventId);
        const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
        
        if (outcomeIndex === -1) throw new ApiError(StatusCodes.NOT_FOUND, 'Outcome not found');

        // Current price
        const currentPrices = this.calculatePrices(currentShares, b);
        const currentPrice = currentPrices[outcomeIndex];

        // Binary search for optimal shares
        let low = 1;
        let high = usdAmount * 100; // Scale factor for precision
        let optimalShares = 0;
        let finalCost = 0;
        let newPrice = currentPrice;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const testShares = [...currentShares];
            testShares[outcomeIndex] += mid;

            const cost = this.calculateCost(currentShares, testShares, b);
            const withFee = cost * (1 + this.FEE_RATE);

            if (withFee <= usdAmount) {
                optimalShares = mid;
                finalCost = withFee;
                newPrice = this.calculatePrices(testShares, b)[outcomeIndex];
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        const fee = finalCost * this.FEE_RATE;
        const priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;

        return {
            usdAmount: finalCost,
            shares: optimalShares,
            pricePerShare: finalCost / optimalShares,
            priceImpact,
            totalFee: fee,
            afterFees: finalCost - fee,
            newPrice
        };
    }

    /**
     * Quote Shares to USD conversion
     * Given a number of shares, calculate how much USD you would receive
     */
    public async quoteeSharesToUsd(
        eventId: number,
        outcomeId: number,
        sharesToSell: number
    ): Promise<QuoteResult> {
        const { shares: currentShares, b, outcomes } = await this.getMarketState(eventId);
        const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);

        if (outcomeIndex === -1) throw new ApiError(StatusCodes.NOT_FOUND, 'Outcome not found');

        // Current price
        const currentPrices = this.calculatePrices(currentShares, b);
        const currentPrice = currentPrices[outcomeIndex];

        // Calculate new shares state
        const newShares = [...currentShares];
        newShares[outcomeIndex] = Math.max(newShares[outcomeIndex] - sharesToSell, this.MIN_SHARES);

        // Calculate return amount
        const returnAmount = this.calculateCost(newShares, currentShares, b);
        const fee = returnAmount * this.FEE_RATE;
        const afterFees = returnAmount - fee;

        // Calculate new price
        const newPrice = this.calculatePrices(newShares, b)[outcomeIndex];
        const priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;

        return {
            usdAmount: returnAmount,
            shares: sharesToSell,
            pricePerShare: returnAmount / sharesToSell,
            priceImpact,
            totalFee: fee,
            afterFees,
            newPrice
        };
    }

    // Get current market prices
    public async getPrices(eventId: number, btcPrice?: number) {
        const { shares, b, outcomes } = await this.getMarketState(eventId);
        const prices = this.calculatePrices(shares, b);

        return outcomes.map((outcome, index) => ({
            outcomeId: outcome.id,
            title: outcome.outcome_title,
            price: prices[index],
            currentSupply: outcome.current_supply,
            totalLiquidity: outcome.total_liquidity,
            btcPrice: btcPrice
        }));
    }

    // Get current market price of a outcome
    public async getOutcomePrice(eventId: number, outcomeId: number) {
        const { shares, b, outcomes } = await this.getMarketState(eventId);
        const prices = this.calculatePrices(shares, b);

        const result = outcomes.find((outcome, index) => outcome.id === outcomeId);
        const index = outcomes.indexOf(result); // Get index of the found outcome

        return {
            outcomeId: result.id,
            title: result.outcome_title,
            price: prices[index],
            currentSupply: result.current_supply,
            totalLiquidity: result.total_liquidity,
        };
    }

    // Initialize a new market
    public async initializeMarket(eventId: number) {
        const outcomes = await prisma.outcome.findMany({
            where: { eventID: eventId }
        });

        await Promise.all(outcomes.map(outcome =>
            prisma.outcome.update({
                where: { id: outcome.id },
                data: {
                    total_liquidity: this.INITIAL_LIQUIDITY,
                    current_supply: this.MIN_SHARES
                }
            })
        ));

        return this.getPrices(eventId);
    }
}

// Export the AMM
export const amm = new LMSR_AMM();

// Example usage
async function testAMM() {
    try {

        // Get initial prices
        console.log('Initial prices:', await amm.getPrices(1));

        // Buy shares
        const buyResult = await amm.buyShares(1, 2, 200, 1);
        console.log('Buy result:', buyResult);

        // Get updated prices
        console.log('Updated prices:', await amm.getPrices(1));

        // Sell shares
        // const sellResult = await amm.sellShares(1, 3, 5, 1);
        // console.log('Sell result:', sellResult);

        // Get final prices
        console.log('Final prices:', await amm.getPrices(1));

    } catch (error) {
        console.error('ApiError:', error);
    }
}

if (require.main === module) {
    testAMM().finally(() => prisma.$disconnect());
}