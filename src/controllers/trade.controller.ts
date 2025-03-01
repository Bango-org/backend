import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync';
import { amm } from '../cpmm';
import prisma from '../client';
import { OrderType } from '@prisma/client';
import pick from '../utils/pick';
import { tradeService } from '../services';
import env from "../config/config";

const buyTrade = catchAsync(async (req, res) => {

    const { eventId, outcomeId, usdtAmount } = req.body;

    const outcome = await prisma.outcome.findFirst({
        where: {
            id: outcomeId,
            eventID: eventId
        }
    });

    if (outcome === null) {
        res.status(StatusCodes.NOT_FOUND).send("Outcome Not Found")
        return;
    }

    let usr: any = req.user;
    const buyResult = await amm.buyShares(eventId, outcomeId, usdtAmount, usr.id);

    res.status(StatusCodes.CREATED).send(buyResult);

});

const sellTrade = catchAsync(async (req, res) => {
    const { eventId, outcomeId, sharesToSell } = req.body;

    const outcome = await prisma.outcome.findFirst({
        where: {
            id: outcomeId,
            eventID: eventId
        }
    });

    if (outcome === null) {
        res.status(StatusCodes.NOT_FOUND).send("Outcome Not Found")
        return;
    }

    let usr: any = req.user;
    const sellResult = await amm.sellShares(eventId, outcomeId, sharesToSell, usr.id);

    res.status(StatusCodes.CREATED).send(sellResult);

});


const getTrades = catchAsync(async (req, res) => {
    const filter = pick(req.query, ['id', 'unique_id', 'order_type', 'order_size', 'eventID', 'outcomeId', 'userID']);
    const dateFilter = pick(req.query, ['startDate', 'endDate']);

    const options = pick(req.query, ['sortBy', 'limit', 'page']);
    const result = await tradeService.queryTrades(filter, options, dateFilter);

    res.send(result);
});

const getOutcomeShares = catchAsync(async (req, res) => {

    let usr: any = req.user;

    const shares = await prisma.tokenAllocation.findMany({
        where: {
            userId: usr.id,
            outcome: {
                eventID: req.params.eventId
            }
        },
        select: {
            amount: true,
            userId: true,
            createdAt: true,
            updatedAt: true,
            outcome: {
                select: {
                    id: true,
                    outcome_title: true
                }
            }
        }
    })


    res.status(StatusCodes.OK).send(shares);
});

const getOutcomePrices = catchAsync(async (req, res) => {

    // const btcUsd = await fetch(`https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=BTC&convert=USD`, {
    //     method: "GET",
    //     headers: {
    //         'Accepts': 'application/json',
    //         "X-CMC_PRO_API_KEY": env.coin_market_cap_api
    //     }
    // })

    const btcUsd = await fetch(`https://api.diadata.org/v1/assetQuotation/Bitcoin/0x0000000000000000000000000000000000000000`, {
        method: "GET",
    })

    const jsn = await btcUsd.json();
    const btcPrice = jsn.Price;

    let prices = await amm.getPrices(req.params.eventId, btcPrice)

    res.status(StatusCodes.OK).send(prices);
});


export default {
    buyTrade,
    sellTrade,
    getOutcomePrices,
    getOutcomeShares,
    getTrades
};
