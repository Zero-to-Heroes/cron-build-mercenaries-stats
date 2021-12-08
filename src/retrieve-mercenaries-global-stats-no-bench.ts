/* eslint-disable @typescript-eslint/no-use-before-define */
import { AllCardsService, CardIds, ScenarioId, TagRole } from '@firestone-hs/reference-data';
import { ServerlessMysql } from 'serverless-mysql';
import {
	MercenariesComposition,
	MercenariesGlobalStats,
	MercenariesHeroStat,
	MercenariesPvp,
	MmrPercentile,
	SkillInfo,
} from './stat';
import { groupByFunction, sumOnArray } from './utils/util-functions';

const allCards = new AllCardsService();

export const loadNewStatsNoBench = async (mysql: ServerlessMysql): Promise<MercenariesGlobalStats> => {
	await allCards.initializeCardsDb();
	const [lastPatch] = await Promise.all([getLastPatch()]);

	const rows: readonly MercenariesDbRow[] = await loadRows(mysql);

	return {
		lastUpdateDate: new Date(),
		pvp: buildPvP(rows.filter(row => row.scenarioId === ScenarioId.LETTUCE_PVP)),
	};
};

const buildPvP = (rows: MercenariesDbRow[]): MercenariesPvp => {
	const mmrPercentiles: readonly MmrPercentile[] = buildMmrPercentiles(rows);

	const grouped: { [groupingKey: string]: readonly MercenariesDbRow[] } = groupByFunction(
		(row: MercenariesDbRow) =>
			`${row.heroCardId}-${row.equipmentCardId}-${row.battleEnterTiming === 1}-${clampHeroLevel(row.heroLevel)}`,
	)(rows);
	console.debug('grouped for hero stats');
	const heroStats: readonly MercenariesHeroStat[] = mmrPercentiles
		.map(percentile => buildHeroStatsForDifficulty(grouped, percentile))
		.reduce((a, b) => [...a, ...b], []);

	const groupedByMatch: { [groupingKey: string]: readonly MercenariesDbRow[] } = groupByFunction(
		(row: MercenariesDbRow) => row.reviewId,
	)(rows);
	console.debug('grouped for compositions');
	const compositions: readonly MercenariesComposition[] = mmrPercentiles
		.map(percentile => buildCompositionsForDifficulty(groupedByMatch, percentile))
		.reduce((a, b) => [...a, ...b], []);

	return {
		mmrPercentiles: mmrPercentiles,
		heroStats: heroStats,
		compositions: compositions,
	};
};

const buildHeroStatsForDifficulty = (
	grouped: { [groupingKey: string]: readonly MercenariesDbRow[] },
	difficulty: MmrPercentile,
): readonly MercenariesHeroStat[] => {
	// const pastThree = buildHeroStats(
	// 	grouped,
	// 	row =>
	// 		row.startDate >= new Date(new Date().getTime() - 3 * 24 * 60 * 60 * 1000) && row.rating >= difficulty.mmr,
	// 	difficulty.percentile,
	// 	'past-three',
	// );
	// console.log('built stats for', 'past-three', difficulty, pastThree.length);

	const pastSeven = buildHeroStats(
		grouped,
		row =>
			row.startDate >= new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000) && row.rating >= difficulty.mmr,
		difficulty.percentile,
		'past-seven',
	);
	console.log('built stats for', 'past-seven', difficulty, pastSeven.length);

	// return [...pastThree, ...pastSeven];
	return [...pastSeven];
};

const buildHeroStats = (
	grouped: { [groupingKey: string]: readonly MercenariesDbRow[] },
	rowFilter: (stat: MercenariesDbRow) => boolean,
	difficulty: 100 | 50 | 25 | 10 | 1,
	period: string,
): readonly MercenariesHeroStat[] => {
	return Object.values(grouped)
		.map(groupedRows => {
			const valid = groupedRows.filter(stat => rowFilter(stat));
			if (!valid?.length) {
				return null;
			}
			const ref = valid[0];
			const debug = ref.heroCardId.startsWith('LT21_03H_0');
			const uniqueSkills = [
				...new Set(
					valid
						.map(row => [row.firstSkillCardId, row.secondSkillCardId, row.thirdSkillCardId])
						.reduce((a, b) => a.concat(b), []),
				),
			]
				.filter(cardId => cardId)
				.sort();
			const skillInfos = uniqueSkills
				.map(skillCardId => valid.map(row => getSkill(row, skillCardId)))
				.reduce((a, b) => a.concat(b), [])
				.filter(skill => !!skill);
			const groupedSkillInfos = groupByFunction((skill: SkillInfo) => skill.cardId)(skillInfos);
			const mergedSkillInfos: readonly SkillInfo[] = Object.values(groupedSkillInfos).map(skillInfos => {
				const ref = skillInfos[0];
				return {
					cardId: ref.cardId,
					numberOfMatches: sumOnArray(skillInfos, skill => skill.numberOfMatches),
					numberOfTimesUsed: sumOnArray(skillInfos, skill => skill.numberOfTimesUsed),
				};
			});
			return {
				date: period,
				mmrPercentile: difficulty,
				heroCardId: ref.heroCardId,
				heroRole: convertRole(allCards.getCard(ref.heroCardId).mercenaryRole),
				heroLevel: clampHeroLevel(ref.heroLevel),
				starter: ref.battleEnterTiming === 1,
				equipementCardId: ref.equipmentCardId,
				totalMatches: valid.length,
				totalWins: valid.filter(row => row.result === 'won').length,
				totalLosses: valid.filter(row => row.result === 'lost').length,
				skillInfos: mergedSkillInfos,
			} as MercenariesHeroStat;
		})
		.filter(info => !!info);
};

const buildCompositionsForDifficulty = (
	groupedByMatch: { [groupingKey: string]: readonly MercenariesDbRow[] },
	difficulty: MmrPercentile,
): readonly MercenariesComposition[] => {
	// const pastThree = buildCompositions(
	// 	groupedByMatch,
	// 	row =>
	// 		row.startDate >= new Date(new Date().getTime() - 3 * 24 * 60 * 60 * 1000) && row.rating >= difficulty.mmr,
	// 	difficulty.percentile,
	// 	'past-three',
	// );
	// console.log('built compositions for', 'past-three', difficulty, pastThree.length);
	const pastSeven = buildCompositions(
		groupedByMatch,
		row =>
			row.startDate >= new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000) && row.rating >= difficulty.mmr,
		difficulty.percentile,
		'past-seven',
	);
	console.log('built compositions for', 'past-seven', difficulty, pastSeven.length);
	return [...pastSeven];
	// return [...pastThree, ...pastSeven];
};

const buildCompositions = (
	groupedByMatch: { [groupingKey: string]: readonly MercenariesDbRow[] },
	rowFilter: (stat: MercenariesDbRow) => boolean,
	difficulty: 100 | 50 | 25 | 10 | 1,
	period: string,
): readonly MercenariesComposition[] => {
	let count = 0;
	const matchInfos = Object.values(groupedByMatch)
		.map(infos => {
			const valid = infos.filter(stat => rowFilter(stat));
			if (!valid?.length) {
				return null;
			}
			const result = {
				heroCardIds: valid.map(info => info.heroCardId).sort(),
				result: valid[0].result,
			};
			if (
				result.heroCardIds.includes(CardIds.XyrellaLettuce3) &&
				result.heroCardIds.includes(CardIds.BlademasterSamuroLettuce3) &&
				result.heroCardIds.includes(CardIds.CairneBloodhoofLettuce3)
			) {
				console.debug('found result with BCX', result, ++count);
			}
			return result;
		})
		.filter(info => !!info && !!info.heroCardIds?.length);
	console.debug('\t', 'matchInfos done');
	const groupedByTeam = groupByFunction((matchInfo: any) => matchInfo.heroCardIds.join(','))(matchInfos);
	console.debug('\t', 'groupedByStarters done');
	return Object.values(groupedByTeam)
		.map(matchInfos => {
			const ref = matchInfos[0];
			// const tempBenches: readonly MercenariesCompositionBench[] = matchInfos.map(matchInfo => ({
			// 	heroCardIds: matchInfo.benchHeroCardIds,
			// 	totalMatches: 1,
			// 	totalWins: matchInfo.result === 'won' ? 1 : 0,
			// 	totalLosses: matchInfo.result === 'lost' ? 1 : 0,
			// }));
			// const groupedByBench = groupByFunction((bench: MercenariesCompositionBench) => bench.heroCardIds.join(','))(
			// 	tempBenches,
			// );
			// const benches: readonly MercenariesCompositionBench[] = Object.values(groupedByBench)
			// 	.map(benches => {
			// 		const ref = benches[0];
			// 		return {
			// 			heroCardIds: ref.heroCardIds,
			// 			totalMatches: sumOnArray(benches, bench => bench.totalMatches),
			// 			totalWins: sumOnArray(benches, bench => bench.totalWins),
			// 			totalLosses: sumOnArray(benches, bench => bench.totalLosses),
			// 		};
			// 	})
			// 	.filter(bench => !!bench.heroCardIds?.length && !!bench.totalMatches)
			// 	.filter(bench => bench.totalMatches > 5)
			// 	.sort((a, b) => b.totalWins / b.totalMatches - a.totalWins / a.totalMatches);
			const result = {
				stringifiedHeroes: ref.heroCardIds.join(','),
				date: period,
				heroCardIds: ref.heroCardIds,
				mmrPercentile: difficulty,
				totalMatches: matchInfos.length,
				totalWins: matchInfos.filter(info => info.result === 'won').length,
				totalLosses: matchInfos.filter(info => info.result === 'lost').length,
				benches: null,
			} as MercenariesComposition;

			if (
				result.heroCardIds.includes(CardIds.XyrellaLettuce3) &&
				result.heroCardIds.includes(CardIds.BlademasterSamuroLettuce3) &&
				result.heroCardIds.includes(CardIds.CairneBloodhoofLettuce3)
			) {
				console.debug('found result with BCX 2', result);
			}
			return result;
		})
		.filter(info => !!info && info.totalMatches)
		.filter(info => info.totalMatches > 10)
		.sort((a, b) => b.totalWins / b.totalMatches - a.totalWins / a.totalMatches);
};

const convertRole = (role: string): 'caster' | 'fighter' | 'protector' => {
	switch (role) {
		case TagRole[TagRole.CASTER]:
			return 'caster';
		case TagRole[TagRole.FIGHTER]:
			return 'fighter';
		case TagRole[TagRole.TANK]:
			return 'protector';
		default:
			return null;
	}
};

const getSkill = (row: MercenariesDbRow, skillCardId: string): SkillInfo => {
	if (row.firstSkillCardId === skillCardId) {
		return {
			cardId: row.firstSkillCardId,
			level: row.firstSkillLevel,
			numberOfMatches: 1,
			numberOfTimesUsed: row.firstSkillNumberOfTimesUsed,
		} as any;
	} else if (row.secondSkillCardId === skillCardId) {
		return {
			cardId: row.secondSkillCardId,
			level: row.secondSkillLevel,
			numberOfMatches: 1,
			numberOfTimesUsed: row.secondSkillNumberOfTimesUsed,
		} as any;
	} else if (row.thirdSkillCardId === skillCardId) {
		return {
			cardId: row.thirdSkillCardId,
			level: row.thirdSkillLevel,
			numberOfMatches: 1,
			numberOfTimesUsed: row.thirdSkillNumberOfTimesUsed,
		} as any;
	}
	return null;
};

const clampHeroLevel = (heroLevel: number): number => {
	if (heroLevel === 30) {
		return 30;
	} else if (heroLevel >= 15) {
		return 15;
	} else if (heroLevel >= 5) {
		return 5;
	} else {
		return 1;
	}
};

const buildMmrPercentiles = (rows: readonly MercenariesDbRow[]): readonly MmrPercentile[] => {
	const rowsForPvP = rows.filter(row => row.rating != null);
	const sortedMmrs = rowsForPvP.map(row => row.rating).sort((a, b) => a - b);
	const median = sortedMmrs[Math.floor(sortedMmrs.length / 2)];
	const top25 = sortedMmrs[Math.floor((sortedMmrs.length / 4) * 3)];
	const top10 = sortedMmrs[Math.floor((sortedMmrs.length / 10) * 9)];
	const top1 = sortedMmrs[Math.floor((sortedMmrs.length / 100) * 99)];
	console.debug('percentiles', median, top25, top10, top1);
	return [
		{
			percentile: 100,
			mmr: 0,
		},
		{
			percentile: 50,
			mmr: median,
		},
		{
			percentile: 25,
			mmr: top25,
		},
		{
			percentile: 10,
			mmr: top10,
		},
		{
			percentile: 1,
			mmr: top1,
		},
	];
};

const loadRows = async (mysql: ServerlessMysql): Promise<readonly MercenariesDbRow[]> => {
	// Don't load data that we won't use
	const query = `
		SELECT 
			startDate, scenarioId, result, rating, difficulty,
			reviewId,
			heroCardId, battleEnterTiming, heroLevel,
			equipmentCardId, equipmentLevel,
			firstSkillCardId, firstSkillLevel, firstSkillNumberOfTimesUsed,
			secondSkillCardId, secondSkillLevel, secondSkillNumberOfTimesUsed,
			thirdSkillCardId, thirdSkillLevel, thirdSkillNumberOfTimesUsed,
			bountyId
		FROM mercenaries_match_stats
		WHERE startDate > DATE_SUB(NOW(), INTERVAL 30 DAY)
		AND scenarioId IN (${ScenarioId.LETTUCE_PVP})
	`;
	console.log('running query', query);
	const rows: readonly MercenariesDbRow[] = await mysql.query(query);
	console.log('rows', rows?.length);
	return rows;
};

const getLastPatch = async (): Promise<PatchInfo> => {
	return null;
	// const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json?v=2`);
	// const structuredPatch = JSON.parse(patchInfo);
	// const patchNumber = structuredPatch.currentMercenariesMetaPatch;
	// return structuredPatch.patches.find(patch => patch.number === patchNumber);
};

interface PatchInfo {
	readonly number: number;
	readonly name: string;
	readonly version: string;
	readonly date: string;
}

export interface MercenariesDbRow {
	readonly id: number;
	readonly startDate: Date;
	readonly reviewId: string; // So you'll have 6 rows per review
	readonly result: 'won' | 'lost' | 'tied';
	readonly scenarioId: number; // If I ever want to group things by bounty afterwards, this should be enough
	readonly rating?: number;
	readonly difficulty?: 'normal' | 'heroic' | 'legendary';
	readonly buildNumber: number;
	readonly heroCardId: string;
	readonly battleEnterTiming: number; // The turn at which the hero entered the battle. The 3 starter heroes enter turn 1
	readonly equipmentCardId: string;
	readonly heroLevel: number;
	readonly equipmentLevel: number;
	readonly firstSkillCardId: string;
	readonly firstSkillLevel: number;
	readonly firstSkillNumberOfTimesUsed: number;
	readonly secondSkillCardId: string;
	readonly secondSkillLevel: number;
	readonly secondSkillNumberOfTimesUsed: number;
	readonly thirdSkillCardId: string;
	readonly thirdSkillLevel: number;
	readonly thirdSkillNumberOfTimesUsed: number;
	// readonly skillInfos: readonly DbSkillInfo[];
	readonly treasures: readonly string[];
}
