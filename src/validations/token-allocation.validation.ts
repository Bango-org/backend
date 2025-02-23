import Joi from 'joi';

const getTokenAllocations = {
  query: Joi.object().keys({
    id: Joi.number(),
    amount: Joi.number(),
    userId: Joi.number(),
    outcomeId: Joi.number(),
    updatedAt: Joi.date(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer()
  })
};

const getTokenAllocation = {
  params: Joi.object().keys({
    tokenAllocationId: Joi.number().integer()
  })
};

const getTokenBalance = {
  params: Joi.object().keys({
    wallet_address: Joi.string().required()
  })
};


const buyTokens = {
  params: Joi.object().keys({
    txid: Joi.string().required()
  })
};

export default {
  getTokenAllocations,
  getTokenAllocation,
  getTokenBalance,
  buyTokens
};
