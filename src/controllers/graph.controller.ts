import pick from '../utils/pick';
import catchAsync from '../utils/catchAsync';
import prisma from '../client';
import { Prisma } from '@prisma/client';

interface EventGraphFilter {
  eventID?: number;
  startDate?: string;
  endDate?: string;
  type?: string;
}

interface OutcomePriceData {
  outcome: {
    id: number;
    outcome_title: string;
  };
  data: {
    afterPrice: Prisma.Decimal;
    createdAt: Date;
  }[];
}


const getEventIntervalLessGraph = catchAsync(async (req: any, res: any) => {
  const filter: EventGraphFilter = pick(req.query, ['eventID', 'startDate', 'endDate', 'type']);

  const outcomes = await prisma.outcome.findMany({
    where: {
      eventID: filter.eventID
    },
    select: {
      id: true,
      outcome_title: true,
      createdAt: true
    }
  })

  const latestTrade = await prisma.trade.findFirst({
    where: {
      eventID: filter.eventID
    },
    orderBy: {
      createdAt: 'desc'
    },
    select: {
      afterPrice: true,
      createdAt: true
    },
    take: 1
  })

  if (latestTrade === null) {
    return res.send([]).status(200);
  }


  const initPrice = 1 / outcomes.length;


  let outcomesGraphData = await Promise.all(outcomes.map(async(outcome) => {

    let graphData = await prisma.trade.findMany({
      where:{
        eventID: filter.eventID,
        outcomeId: outcome.id
      },
      select: {
        createdAt: true,
        afterPrice: true
      }
    })

    if (graphData.length === 0) {
      return {
        outcome: {
          id: outcome.id,
          outcome_title: outcome.outcome_title,
        },
        data: []
      }
    }
    
    else {
      return {
        outcome: {
          id: outcome.id,
          outcome_title: outcome.outcome_title,
        },
        data: [
          {
            createdAt: outcome.createdAt,
            afterPrice: initPrice.toString()
          },
          ...graphData,
          {
            createdAt: latestTrade?.createdAt,
            afterPrice: graphData[graphData.length - 1].afterPrice
          }
        ]
      }
    }

  }));  


  return res.send(outcomesGraphData).status(200);

});

const getEventGraph = catchAsync(async (req: any, res: any) => {
  const filter: EventGraphFilter = pick(req.query, ['eventID', 'startDate', 'endDate', 'type']);
  let endTime = new Date();

  // Get the first trade time for this event
  const firstTrade = await prisma.trade.findFirst({
    where: { eventID: filter.eventID as number },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true }
  });

  if (!firstTrade) {
    return res.send({
      timeRange: { start: endTime, end: endTime, interval: '1 minute' },
      data: []
    });
  }

  // Calculate desired range based on type
  let desiredStartTime: Date;
  let interval: string;

  switch (filter.type) {
    case 'hour':
      desiredStartTime = new Date(endTime.getTime() - 60 * 60 * 1000); // 1 hour ago
      interval = '1 second';
      break;
    case 'day':
      desiredStartTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
      interval = '1 minute';
      break;
    case 'month':
      desiredStartTime = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      interval = '1 hour';
      break;
    case 'year':
      desiredStartTime = new Date(endTime.getTime() - 365 * 24 * 60 * 60 * 1000); // 365 days ago
      interval = '1 day';
      break;
    case 'all':
    default:
      desiredStartTime = firstTrade.createdAt;
      interval = '1 day';
      break;
  }

  // Use the later of firstTrade.createdAt or desiredStartTime
  let startTime = firstTrade.createdAt > desiredStartTime ?
    firstTrade.createdAt :
    desiredStartTime;




  // Override with explicit dates if provided
  if (filter.startDate) startTime = new Date(filter.startDate);
  if (filter.endDate) endTime = new Date(filter.endDate);

  const outcomes = await prisma.outcome.findMany({
    where: {
      eventID: filter.eventID as number
    },
    select: {
      id: true,
      outcome_title: true
    }
  });

  const outcomesPriceData: OutcomePriceData[] = await Promise.all(
    outcomes.map(async (outcome) => {
      // Get first trade for this specific outcome
      const outcomeFirstTrade = await prisma.trade.findFirst({
        where: {
          eventID: filter.eventID as number,
          outcomeId: outcome.id
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true }
      });

      if (!outcomeFirstTrade) {
        return {
          outcome,
          data: []
        };
      }

      // Use the later of outcome's first trade or overall start time
      const outcomeStartTime = outcomeFirstTrade.createdAt > startTime ?
        outcomeFirstTrade.createdAt :
        startTime;

      const priceData = await prisma.$queryRaw<{ timestamp: Date, price: Prisma.Decimal }[]>`
        WITH RECURSIVE 
        time_series AS (
          SELECT 
            date_trunc(
              CASE 
                WHEN ${interval} = '1 second' THEN 'second'
                WHEN ${interval} = '1 minute' THEN 'minute'
                WHEN ${interval} = '1 hour' THEN 'hour'
                ELSE 'day'
              END,
              ${outcomeStartTime}::timestamp
            ) as timestamp
          UNION ALL
          SELECT 
            timestamp + ${interval}::interval
          FROM time_series
          WHERE timestamp < ${endTime}::timestamp
        ),
        trades_with_intervals AS (
          SELECT 
            date_trunc(
              CASE 
                WHEN ${interval} = '1 second' THEN 'second'
                WHEN ${interval} = '1 minute' THEN 'minute'
                WHEN ${interval} = '1 hour' THEN 'hour'
                ELSE 'day'
              END,
              t."createdAt"
            ) as interval_timestamp,
            t."afterPrice",
            ROW_NUMBER() OVER (
              PARTITION BY date_trunc(
                CASE 
                  WHEN ${interval} = '1 second' THEN 'second'
                  WHEN ${interval} = '1 minute' THEN 'minute'
                  WHEN ${interval} = '1 hour' THEN 'hour'
                  ELSE 'day'
                END,
                t."createdAt"
              )
              ORDER BY t."createdAt" DESC
            ) as rn
          FROM "Trade" t
          WHERE 
            t."outcomeId" = ${outcome.id}
            AND t."eventID" = ${filter.eventID}
            AND t."createdAt" >= ${outcomeStartTime}
            AND t."createdAt" <= ${endTime}
        )
        SELECT 
          ts.timestamp,
          COALESCE(
            (
              SELECT ti."afterPrice"
              FROM trades_with_intervals ti
              WHERE ti.interval_timestamp <= ts.timestamp
              AND ti.rn = 1
              ORDER BY ti.interval_timestamp DESC
              LIMIT 1
            ),
            (
              SELECT t."afterPrice"
              FROM "Trade" t
              WHERE 
                t."outcomeId" = ${outcome.id}
                AND t."eventID" = ${filter.eventID}
                AND t."createdAt" <= ${endTime}
              ORDER BY t."createdAt" DESC
              LIMIT 1
            ),
            0
          ) as price
        FROM time_series ts
        ORDER BY ts.timestamp;
      `;

      return {
        outcome,
        data: priceData.map(row => ({
          afterPrice: row.price,
          createdAt: row.timestamp
        }))
      };
    })
  );

  res.send({
    timeRange: {
      start: startTime,
      end: endTime,
      interval: interval,
      type: filter.type
    },
    data: outcomesPriceData
  });
});

export default {
  getEventGraph,
  getEventIntervalLessGraph
};
