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
    outcomes: any[];
}

/**
 * Constant Product Market Maker (CPMM) AMM for prediction markets
 * 
 * This AMM uses a simple share-based model where:
 * - Each outcome has a pool of shares
 * - Price of an outcome is its shares divided by the total shares
 * - When someone buys shares of an outcome, they add to that outcome's share pool
 * - Prices are recalculated based on the new share distribution
 */
class CPMM_AMM {
    private readonly FEE_RATE = 0.02;           // 2% fee
    private readonly INITIAL_LIQUIDITY = 100;   // Initial liquidity per outcome
    private readonly MIN_SHARES = 1;            // Minimum shares to maintain
    private readonly MAX_PRICE_IMPACT = 0.5;    // Maximum allowed price impact (50%)
    private readonly MIN_PRICE = 0.001;         // Minimum price (not exactly 0)
    private readonly MAX_PRICE = 0.999;         // Maximum price (not exactly 1)
    
    /**
     * Get current market state from the database
     */
    private async getMarketState(eventId: number): Promise<MarketState> {
        const outcomes = await prisma.outcome.findMany({
            where: {
                eventID: eventId
            },
        });

        if (outcomes.length === 0) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Event outcomes not found');
        }

        const shares = outcomes.map(o => Math.max(o.current_supply.toNumber(), this.MIN_SHARES));
        
        return { shares, outcomes };
    }
    
    /**
     * Calculate prices based on shares
     * Price of outcome i = shares[i] / sum(shares)
     * Then normalize to ensure 0 < price < 1 and sum = 1
     */
    private calculatePrices(shares: number[]): number[] {
        const total = shares.reduce((sum, share) => sum + share, 0);
        
        // Initial price calculation
        let prices = shares.map(share => share / total);
        
        // Ensure prices are within bounds (not exactly 0 or 1)
        prices = prices.map(p => Math.min(Math.max(p, this.MIN_PRICE), this.MAX_PRICE));
        
        // Normalize again to ensure sum is 1
        const sum = prices.reduce((s, p) => s + p, 0);
        return prices.map(p => p / sum);
    }
    
    /**
     * Calculate price impacts after a trade
     */
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
    
    /**
     * Buy shares of an outcome
     */
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

            if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
            if (user.playmoney < amount) throw new ApiError(StatusCodes.BAD_REQUEST, 'Insufficient balance');

            // Get market state
            const { shares, outcomes } = await this.getMarketState(eventId);
            const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
            
            if (outcomeIndex === -1) throw new ApiError(StatusCodes.NOT_FOUND, 'Outcome not found');

            // Calculate current prices
            const pricesBefore = this.calculatePrices(shares);
            
            // Calculate fee
            const fee = amount * this.FEE_RATE;
            const amountAfterFee = amount - fee;
            
            // Calculate shares to buy based on current price
            const sharesToBuy = Math.floor(amountAfterFee / pricesBefore[outcomeIndex]);
            
            if (sharesToBuy <= 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Amount too small');
            
            // Update shares
            const newShares = [...shares];
            newShares[outcomeIndex] += sharesToBuy;
            
            // Calculate new prices
            const pricesAfter = this.calculatePrices(newShares);
            
            // Calculate price impacts
            const priceImpacts = this.calculatePriceImpacts(outcomes, pricesBefore, pricesAfter);
            
            // Check price impact
            if (Math.abs(priceImpacts[outcomeIndex].impact) > this.MAX_PRICE_IMPACT * 100) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST, 
                    'Price impact too high - try a smaller amount'
                );
            }
            
            // Update user balance
            await tx.user.update({
                where: { id: userId },
                data: { playmoney: { decrement: amount } }
            });
            
            // Update outcome
            await tx.outcome.update({
                where: { id: outcomeId },
                data: {
                    current_supply: { increment: sharesToBuy },
                    total_liquidity: { increment: amountAfterFee }
                }
            });
            
            // Distribute fees to all outcomes as additional liquidity
            const feePerOutcome = fee / outcomes.length;
            for (const outcome of outcomes) {
                await tx.outcome.update({
                    where: { id: outcome.id },
                    data: {
                        total_liquidity: { increment: feePerOutcome }
                    }
                });
            }
            
            // Record trade
            const priceImpactForOutcome = priceImpacts.find((impact) => impact.outcomeId === outcomeId);
            
            await tx.trade.create({
                data: {
                    order_type: 'BUY',
                    order_size: sharesToBuy,
                    amount: amount,
                    eventID: eventId,
                    userID: userId,
                    outcomeId: outcomeId,
                    afterPrice: priceImpactForOutcome?.afterPrice
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
                cost: amount,
                priceImpacts
            };
        });
    }
    
    /**
     * Sell shares of an outcome
     */
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
            const { shares, outcomes } = await this.getMarketState(eventId);
            const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
            
            if (outcomeIndex === -1) throw new ApiError(StatusCodes.NOT_FOUND, 'Outcome not found');

            // Calculate current prices
            const pricesBefore = this.calculatePrices(shares);
            
            // Calculate new shares after selling
            const newShares = [...shares];
            
            // Ensure we maintain minimum shares
            if (newShares[outcomeIndex] - sharesToSell < this.MIN_SHARES) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST, 
                    'Selling this amount would reduce shares below minimum'
                );
            }
            
            newShares[outcomeIndex] -= sharesToSell;
            
            // Calculate new prices
            const pricesAfter = this.calculatePrices(newShares);
            
            // Calculate amount to return
            const returnAmount = sharesToSell * pricesBefore[outcomeIndex];
            const fee = returnAmount * this.FEE_RATE;
            const returnAfterFee = returnAmount - fee;
            
            // Check outcome liquidity
            const outcome = outcomes[outcomeIndex];
            if (outcome.total_liquidity.toNumber() < returnAfterFee) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST, 
                    'Insufficient liquidity in the market'
                );
            }
            
            // Calculate price impacts
            const priceImpacts = this.calculatePriceImpacts(outcomes, pricesBefore, pricesAfter);
            
            // Check price impact
            if (Math.abs(priceImpacts[outcomeIndex].impact) > this.MAX_PRICE_IMPACT * 100) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST, 
                    'Price impact too high - try selling fewer shares'
                );
            }
            
            // Update outcome
            await tx.outcome.update({
                where: { id: outcomeId },
                data: {
                    current_supply: { decrement: sharesToSell },
                    total_liquidity: { decrement: returnAfterFee }
                }
            });
            
            // Distribute fees to all outcomes
            const feePerOutcome = fee / outcomes.length;
            for (const outcome of outcomes) {
                await tx.outcome.update({
                    where: { id: outcome.id },
                    data: {
                        total_liquidity: { increment: feePerOutcome }
                    }
                });
            }
            
            // Update user balance
            await tx.user.update({
                where: { id: userId },
                data: { playmoney: { increment: returnAfterFee } }
            });
            
            // Update token allocation
            await tx.tokenAllocation.update({
                where: {
                    userId_outcomeId: { userId, outcomeId }
                },
                data: { amount: { decrement: sharesToSell } }
            });
            
            const priceImpactForOutcome = priceImpacts.find((impact) => impact.outcomeId === outcomeId);
            
            // Record trade
            await tx.trade.create({
                data: {
                    order_type: 'SELL',
                    order_size: sharesToSell,
                    amount: returnAfterFee,
                    eventID: eventId,
                    userID: userId,
                    outcomeId: outcomeId,
                    afterPrice: priceImpactForOutcome?.afterPrice
                }
            });
            
            return {
                shares: sharesToSell,
                cost: returnAfterFee,
                priceImpacts
            };
        });
    }
    
    /**
     * Get current market prices and share supplies
     */
    public async getMarketPrices(eventId: number) {
        const { shares, outcomes } = await this.getMarketState(eventId);
        const prices = this.calculatePrices(shares);

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
        // Get market state
        const { shares, outcomes } = await this.getMarketState(eventId);
        const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
        
        if (outcomeIndex === -1) throw new ApiError(StatusCodes.NOT_FOUND, 'Outcome not found');

        // Calculate current price
        const currentPrices = this.calculatePrices(shares);
        const currentPrice = currentPrices[outcomeIndex];
        
        // Calculate fee
        const fee = usdAmount * this.FEE_RATE;
        const amountAfterFee = usdAmount - fee;
        
        // Calculate shares to buy based on current price
        const sharesToBuy = Math.floor(amountAfterFee / currentPrice);
        
        // Calculate new shares and prices
        const newShares = [...shares];
        newShares[outcomeIndex] += sharesToBuy;
        
        const newPrices = this.calculatePrices(newShares);
        const newPrice = newPrices[outcomeIndex];
        
        // Calculate price impact
        const priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;
        
        return {
            usdAmount: usdAmount,
            shares: sharesToBuy,
            pricePerShare: usdAmount / sharesToBuy,
            priceImpact: priceImpact,
            totalFee: fee,
            afterFees: amountAfterFee,
            newPrice: newPrice
        };
    }
    
    /**
     * Quote Shares to USD conversion
     * Given a number of shares, calculate how much USD you would receive
     */
    public async quoteSharesToUsd(
        eventId: number,
        outcomeId: number,
        sharesToSell: number
    ): Promise<QuoteResult> {
        // Get market state
        const { shares, outcomes } = await this.getMarketState(eventId);
        const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
        
        if (outcomeIndex === -1) throw new ApiError(StatusCodes.NOT_FOUND, 'Outcome not found');

        // Ensure we maintain minimum shares
        if (shares[outcomeIndex] - sharesToSell < this.MIN_SHARES) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST, 
                'Selling this amount would reduce shares below minimum'
            );
        }
        
        // Calculate current price
        const currentPrices = this.calculatePrices(shares);
        const currentPrice = currentPrices[outcomeIndex];
        
        // Calculate return amount based on current price
        const returnAmount = sharesToSell * currentPrice;
        const fee = returnAmount * this.FEE_RATE;
        const returnAfterFee = returnAmount - fee;
        
        // Calculate new shares and prices after selling
        const newShares = [...shares];
        newShares[outcomeIndex] -= sharesToSell;
        
        const newPrices = this.calculatePrices(newShares);
        const newPrice = newPrices[outcomeIndex];
        
        // Calculate price impact
        const priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;
        
        return {
            usdAmount: returnAmount,
            shares: sharesToSell,
            pricePerShare: returnAmount / sharesToSell,
            priceImpact: priceImpact,
            totalFee: fee,
            afterFees: returnAfterFee,
            newPrice: newPrice
        };
    }
    
    /**
     * Get current market prices for all outcomes
     */
    public async getPrices(eventId: number, btcPrice?: number) {
        const { shares, outcomes } = await this.getMarketState(eventId);
        const prices = this.calculatePrices(shares);

        return outcomes.map((outcome, index) => ({
            outcomeId: outcome.id,
            title: outcome.outcome_title,
            price: prices[index],
            currentSupply: outcome.current_supply,
            totalLiquidity: outcome.total_liquidity,
            btcPrice: btcPrice
        }));
    }
    
    /**
     * Get current market price of a specific outcome
     */
    public async getOutcomePrice(eventId: number, outcomeId: number) {
        const { shares, outcomes } = await this.getMarketState(eventId);
        const prices = this.calculatePrices(shares);

        const outcome = outcomes.find(o => o.id === outcomeId);
        if (!outcome) throw new ApiError(StatusCodes.NOT_FOUND, 'Outcome not found');
        
        const index = outcomes.findIndex(o => o.id === outcomeId);

        return {
            outcomeId: outcome.id,
            title: outcome.outcome_title,
            price: prices[index],
            currentSupply: outcome.current_supply,
            totalLiquidity: outcome.total_liquidity,
        };
    }
    
    /**
     * Initialize a new market
     */
    public async initializeMarket(eventId: number) {
        const outcomes = await prisma.outcome.findMany({
            where: { eventID: eventId }
        });

        if (outcomes.length === 0) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Event outcomes not found');
        }
        
        // Initialize with equal shares and liquidity for each outcome
        const equalShares = this.MIN_SHARES;
        const equalLiquidity = this.INITIAL_LIQUIDITY;
        
        // Update each outcome
        await Promise.all(outcomes.map(outcome =>
            prisma.outcome.update({
                where: { id: outcome.id },
                data: {
                    total_liquidity: equalLiquidity,
                    current_supply: equalShares
                }
            })
        ));
        
        return this.getPrices(eventId);
    }
}

// Export the AMM
export const amm = new CPMM_AMM();

// Example usage
async function testCPMM() {
    try {
        // Initialize market
        console.log('Initializing market...');
        await amm.initializeMarket(1);

        // Get initial prices
        console.log('Initial prices:', await amm.getPrices(1));

        // Buy shares
        console.log('Buying shares...');
        const buyResult = await amm.buyShares(1, 2, 200, 1);
        console.log('Buy result:', buyResult);

        // Get updated prices
        console.log('Updated prices:', await amm.getPrices(1));

        // Sell shares (uncomment when needed)
        // console.log('Selling shares...');
        // const sellResult = await amm.sellShares(1, 2, 5, 1);
        // console.log('Sell result:', sellResult);

        // Get final prices
        console.log('Final prices:', await amm.getPrices(1));

    } catch (error) {
        console.error('Error:', error);
    }
}

if (require.main === module) {
    testCPMM().finally(() => prisma.$disconnect());
}