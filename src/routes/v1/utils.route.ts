import express from 'express';
import auth from '../../middlewares/auth';
import validate from '../../middlewares/validate';
import { utilsValidation } from '../../validations';
import { utilsController } from '../../controllers';

const router = express.Router();

router
  .route('/send-bitcoin')
  .post(auth('utils'), validate(utilsValidation.sendBitcoin), utilsController.sendBitcoin)

router
  .route('/fetch-btc-price')
  .get(utilsController.fetchBitcoinprice)


router
  .route('/platform-stats')
  .get(utilsController.fetchPlatformStats)


/**
 * @swagger
 * tags:
 *   name: Utils
 *   description: Utility Apis
 */

/**
 * @swagger
 * /utils/send-bitcoin:
 *   post:
 *     summary: Send test bitcoin 
 *     description: Send test bitcoin to a registered address
 *     tags: [Utils]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *               - signature
 *             properties:
 *               walletAddress:
 *                 type: string
 *               signature:
 *                 type: string
 *             example:
 *               walletAddress: "tb1qen9pqqd84ehwahzxhq88kh273ur8lrlsmj09eu"
 *               signature: "0xe1a2e9174cb8021fbc14bc7e272561572126ed23e97f2232d5ef2de44405291a73b746a5cc5ef82a927f95013dd1fc4393c44b89b8ed84e7a13f4cf922d845161c"
 *     responses:
 *       "201":
 *         description: Created
 *       "401":
 *         $ref: '#/components/responses/Unauthorized'
 *       "403":
 *         $ref: '#/components/responses/Forbidden'
 *
 */


/**
 * @swagger
 * /utils/fetch-btc-price:
 *   get:
 *     summary: Fetch BTC Price 
 *     description: Fetch BTC Price
 *     tags: [Utils]
 *     responses:
 *       "200":
 *         description: Ok
 *
 */


/**
 * @swagger
 * /utils/platform-stats:
 *   get:
 *     summary: Fetch Predictr platform stats 
 *     tags: [Utils]
 *     responses:
 *       "200":
 *         description: Ok
 *
 */


export default router;