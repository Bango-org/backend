import { StatusCodes } from 'http-status-codes';
import pick from '../utils/pick';
import ApiError from '../utils/ApiError';
import catchAsync from '../utils/catchAsync';
import { userService } from '../services';

const getUsers = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['username', 'wallet_address']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await userService.queryUsers(filter, options);
  res.send(result);
});

const getUser = catchAsync(async (req, res) => {
  const user = await userService.getUserByAddress(req.params.wallet_address);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }
  res.send(user);
});

const updateUser = catchAsync(async (req, res) => {

  let usr: any = req.user;

  const user = await userService.updateUserByWalletAddress(usr.wallet_address, req.body);
  res.send(user);
});


export default {
  getUsers,
  getUser,
  updateUser,
};
