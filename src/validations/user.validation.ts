import Joi from 'joi';

const getUsers = {
  query: Joi.object().keys({
    username: Joi.string(),
    wallet_address: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer()
  })
};

const getUser = {
  params: Joi.object().keys({
    wallet_address: Joi.string().required()
  })
};

const updateUser = {
  body: Joi.object()
    .keys({
      about: Joi.string(),
      profile_pic: Joi.string(),
      username: Joi.string(),
    })
    .min(1)
};


export default {
  getUsers,
  getUser,
  updateUser,
};
