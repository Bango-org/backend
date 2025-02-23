import { StatusCodes } from 'http-status-codes';
import pick from '../utils/pick';
import ApiError from '../utils/ApiError';
import catchAsync from '../utils/catchAsync';
import { tokenAllocationService } from '../services';
import prisma from '../client';
import config from '../config/config';

const getTokenAllocations = catchAsync(async (req, res) => {
    const filter = pick(req.query, ['id', 'amount', 'userId', 'outcomeId', 'createdAt', 'updatedAt']);
    const options = pick(req.query, ['sortBy', 'limit', 'page']);
    const result = await tokenAllocationService.queryTokenAllocation(filter, options);
    res.send(result);
});

const getTokenAllocation = catchAsync(async (req, res) => {
    const tokenAllocation = await tokenAllocationService.getTokenAllocationById(req.params.tokenAllocationId);
    if (!tokenAllocation) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User\'s Allocation not found');
    }
    res.send(tokenAllocation);
});

const getTokenBalance = catchAsync(async (req, res) => {
    
    const wallet_addr: string = req.params.wallet_address?.toString()!;

    const user = await prisma.user.findFirst({
        where: {
            wallet_address: wallet_addr
        }, 
        select:{
            playmoney: true
        }
    })

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Wallet address not found!');
    }
    
    res.send(user)
});

const buyTokens = catchAsync(async (req, res) => {
    
    const txid: string = req.params.txid?.toString()!;

    const resp = await fetch(`https://mempool.space/testnet4/api/tx/${txid}`)

    const btcUsd = await fetch(`https://api.diadata.org/v1/assetQuotation/Bitcoin/0x0000000000000000000000000000000000000000`, {
        method: "GET",
    })

    const btcPriceJsn = await btcUsd.json();
    const btcPrice = btcPriceJsn.Price;
    const satPrice = btcPrice / 100000000; // one sat price

    if (resp.status !== 200){
        throw new ApiError(StatusCodes.NOT_FOUND, "Tx Not found")
    }

    const jsn = await resp.json()

    const from_addr = jsn.vin[0].prevout.scriptpubkey_address
    const to_address = jsn.vout[0].scriptpubkey_address
    const amountSat = jsn.vout[0].value

    if (to_address !== config.token_contract_address) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Invalid Transfer")
    }

    await prisma.user.update({
        where: {
            wallet_address: from_addr
        }, 
        data:{
            playmoney: {
                increment: amountSat * satPrice
            }
        }
    })

    res.send({"message": "PUSD transfered : Arch Network"})
});


export default {
    getTokenAllocations,
    getTokenAllocation,
    getTokenBalance,
    buyTokens
};
