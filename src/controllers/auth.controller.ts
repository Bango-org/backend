import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync';
import { authService, userService, tokenService, emailService } from '../services';
import config from "../config/config";
import prisma from '../client';
import { generator } from '../utils/username-gen';
import * as bip from 'bip322-js';
import * as web3 from "web3";
import e from 'express';

const login = catchAsync(async (req, res) => {
  const { walletAddress, signature, signatureType } = req.body;


  // Verify Signature
  if (signatureType === "bitcoin") {

    const isValid = bip.Verifier.verifySignature(walletAddress, config.signature_message, signature)

    if (!isValid) {
      res.status(400).send("INVALID SIGNATURE");
      return;
    }

  } else {

    let address = web3.eth.accounts.recover(config.signature_message, signature);

    if (address !== walletAddress) {
      res.status(400).send("INVALID SIGNATURE");
      return;
    }

  }


  // Find user if exiss
  let user = await prisma.user.findFirst({
    where: {
      wallet_address: walletAddress
    }
  })

  // Create new user if does not exists
  if (user === null) {

    user = await prisma.user.create({
      data: {
        username: generator.generateWithNumber(),
        about: "",
        wallet_address: walletAddress
      }
    });

  }

  // Generate new Auth Token
  const tokens = await tokenService.generateAuthTokens(user);
  res.send({ user, tokens });
});

const logout = catchAsync(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.status(StatusCodes.NO_CONTENT).send();
});

const refreshTokens = catchAsync(async (req, res) => {
  const tokens = await authService.refreshAuth(req.body.refreshToken);
  res.send({ ...tokens });
});


export default {
  login,
  logout,
  refreshTokens,
};
