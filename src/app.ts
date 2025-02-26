import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import passport from 'passport';
import { StatusCodes } from 'http-status-codes';
import config from './config/config';
import morgan from './config/morgan';
import xss from './middlewares/xss';
import { jwtStrategy } from './config/passport';
import { authLimiter } from './middlewares/rateLimiter';
import routes from './routes/v1';
import { errorConverter, errorHandler } from './middlewares/error';
import ApiError from './utils/ApiError';

const app = express();
app.use(cors());

// const allowedOrigins = [
//   'https://predictr.market',
//   'https://www.testnetapp.xyz',
//   'https://arch-bango-rho.vercel.app'
// ];


if (config.env !== 'test') {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
}




app.use(express.json()); // Ensure JSON parsing middleware is before routes


// set security HTTP headers
app.use(helmet());

// parse json request body
app.use(express.json());

// parse urlencoded request body
app.use(express.urlencoded({ extended: true }));

// sanitize request data
app.use(xss());

// gzip compression
app.use(compression());

// jwt authentication
app.use(passport.initialize());
passport.use('jwt', jwtStrategy);

// limit repeated failed requests to auth endpoints
if (config.env === 'production') {
  app.use('/v1/auth', authLimiter);
}

// v1 api routes
app.use('/v1', routes);

// send back a 404 error for any unknown api request
app.use((req, res, next) => {
  next(new ApiError(StatusCodes.NOT_FOUND, 'Not found'));
});

// convert error to ApiError, if needed
app.use(errorConverter);

// handle error
app.use(errorHandler);

export default app;
