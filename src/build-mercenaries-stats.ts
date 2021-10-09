/* eslint-disable @typescript-eslint/no-use-before-define */
import { AllCardsService } from '@firestone-hs/reference-data';
import { constants, gzipSync } from 'zlib';
import { getConnection } from './db/rds';
import { S3 } from './db/s3';
import { loadNewStats } from './retrieve-mercenaries-global-stats';

const cards = new AllCardsService();
const s3 = new S3();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	await cards.initializeCardsDb();
	const mysql = await getConnection();
	const newStats = await loadNewStats(mysql);
	await mysql.end();

	const gzippedNewResults = gzipSync(JSON.stringify(newStats), {
		level: constants.Z_BEST_COMPRESSION,
	});
	await s3.writeFile(
		gzippedNewResults,
		'static.zerotoheroes.com',
		'api/mercenaries-global-stats.gz.json',
		'application/json',
		'gzip',
	);

	return { statusCode: 200, body: null };
};
