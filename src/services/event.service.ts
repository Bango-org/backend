import { EventStatus, Prisma, Event, Outcome } from '@prisma/client';
import prisma from '../client';

/**
 * Create a Event
 * @param {Object} eventBody
 * @returns {Promise<Event>}
 */
const createEvent = async (
    unique_id: string,
    question: string,
    description: string,
    outcomes: string[],
    resolution_criteria: string,
    image: string,
    expiry_date: Date,
    community: string[],
    wallet_address: string,
): Promise<Event> => {

    let usr = await prisma.user.findUnique({
        where: {
            wallet_address: wallet_address
        }
    })

    return prisma.event.create({
        data: {
            unique_id,
            question,
            description,
            resolution_criteria,
            image,
            expiry_date,
            community,
            userID: usr?.id!,
            status: EventStatus.ACTIVE,
            outcomes: {
                create: outcomes.map((title: string) => {
                    return {
                        outcome_title: title
                    }
                })
            }
        }
    });
};
/**
 * Query for Event
 * @param {Object} filter - Prisma filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryEvents = async <Key extends keyof Event>(
    filter: any,
    options: {
        limit?: number;
        page?: number;
        sortBy?: string;
        sortType?: 'asc' | 'desc';
    },
    keys: Key[] = [
        'id',
        'unique_id',
        'question',
        'description',
        'resolution_criteria',
        'image',
        'outcomeWon',
        'status',
        'expiry_date',
        'community',
        'createdAt',
        'updatedAt'
    ] as Key[]
): Promise<Pick<Event, Key>[]> => {
    // Use transaction to batch all queries and use a single connection
    return prisma.$transaction(async (tx) => {
        const page = options.page ?? 1;
        const limit = options.limit ?? 10;
        const sortBy = options.sortBy;
        const sortType = options.sortType ?? 'desc';

        // Process filter for community
        let newFilter = filter;
        if (filter.community !== undefined) {
            newFilter = {
                ...filter,
                community: {
                    hasSome: [filter.community]
                }
            };
        }

        // Get all events with their related data in one query
        const events = await tx.event.findMany({
            where: newFilter,
            select: {
                id: true,
                ...keys.reduce((obj, k) => ({ ...obj, [k]: true }), {}),
                outcomes: {
                    select: {
                        id: true,
                        outcome_title: true,
                        current_supply: true,
                        total_liquidity: true
                    }
                },
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                },
                _count: {
                    select: {
                        threads: true,
                        trades: true
                    }
                },
            },
            skip: (page - 1) * limit,
            take: limit,
            orderBy: sortBy
                ? { [sortBy.split(":")[0]]: sortBy.split(":")[1] }
                : { createdAt: 'desc' }
        });

        if (events.length === 0) {
            return [];
        }

        // Get all event IDs for efficient batch queries
        const eventIds = events.map(event => event.id);

        // Batch query for user trade counts
        const usersTraded = await tx.$queryRaw<{ event_id: number, count: number }[]>`
            SELECT "eventID" as event_id, COUNT(DISTINCT "userID") AS count
            FROM "Trade"
            WHERE "eventID" IN (${Prisma.join(eventIds)})
            GROUP BY "eventID"
        `;

        // Batch query for volumes
        const volumes = await tx.trade.groupBy({
            by: ['eventID'],
            where: {
                eventID: {
                    in: eventIds
                }
            },
            _sum: {
                amount: true
            }
        });

        // Create lookup maps for faster access
        const userCountMap = new Map();
        usersTraded.forEach(item => {
            userCountMap.set(item.event_id, Number(item.count));
        });

        const volumeMap = new Map();
        volumes.forEach(item => {
            volumeMap.set(item.eventID, item._sum.amount);
        });

        // Combine all data
        const enrichedEvents = events.map(event => ({
            ...event,
            usersTraded: userCountMap.get(event) || 0,
            volume: volumeMap.get(event.id) || 0
        }));

        return enrichedEvents as unknown as Pick<Event, Key>[];
    }, {
        maxWait: 5000, // Maximum amount of time to wait for a transaction
        timeout: 10000  // Maximum amount of time the transaction can run
    });
};

/**
 * Get event by id
 * @param {ObjectId} id
 * @param {Array<Key>} keys
 * @returns {Promise<Pick<Event, Key> | null>}
 */
const getEventById = async <Key extends keyof Event>(
    id: number,
    keys: Key[] = [
        'id',
        'unique_id',
        'question',
        'outcomes',
        'description',
        'resolution_criteria',
        'image',
        'user',
        'status',
        'outcomeWon',
        'expiry_date',
        'community',
        'createdAt',
        'updatedAt'
    ] as Key[]
): Promise<any> => {

    const usersTraded: any = await prisma.$queryRaw<number[]>`
        SELECT COUNT(DISTINCT "userID") AS count
        FROM "Trade"
        WHERE "eventID" = ${id};
    `;

    const volume = await prisma.trade.aggregate({
        where: {
            eventID: id
        },
        _sum: {
            amount: true
        }
    });

    let data = await prisma.event.findUnique({
        where: { id },
        select: {
            ...keys.reduce((obj, k) => ({ ...obj, [k]: true }), {}),
            _count: {
                select: {
                    threads: true,
                    trades: true
                }
            }
        },
    });

    return {
        ...data,
        usersTraded: Number(usersTraded[0].count),
        volume: volume._sum.amount
    }
};


export default {
    createEvent,
    queryEvents,
    getEventById
};
