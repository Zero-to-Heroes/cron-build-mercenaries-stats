/* eslint-disable @typescript-eslint/no-use-before-define */
import { AllCardsService, TagRole } from '@firestone-hs/reference-data';
import { ServerlessMysql } from 'serverless-mysql';
import {
	MercenariesComposition,
	MercenariesCompositionBench,
	MercenariesGlobalStats,
	MercenariesHeroStat,
	MercenariesPve,
	MercenariesPvp,
	MmrPercentile,
	SkillInfo,
} from './stat';
import { groupByFunction, http, sumOnArray } from './utils/util-functions';

const allCards = new AllCardsService();

export const loadNewStats = async (mysql: ServerlessMysql): Promise<MercenariesGlobalStats> => {
	await allCards.initializeCardsDb();
	const [lastPatch] = await Promise.all([getLastPatch()]);

	const rows: readonly MercenariesDbRow[] = await loadRows(mysql);

	return {
		lastUpdateDate: new Date(),
		pve: buildPvE(rows.filter(row => !!row.difficulty)),
		pvp: buildPvP(rows.filter(row => row.rating != null)),
	};
};

const buildPvP = (rows: MercenariesDbRow[]): MercenariesPvp => {
	const mmrPercentiles: readonly MmrPercentile[] = buildMmrPercentiles(rows);
	const heroStats: readonly MercenariesHeroStat[] = mmrPercentiles
		.map(percentile =>
			buildHeroStatsForDifficulty(
				rows.filter(row => row.rating >= percentile.mmr),
				percentile.percentile,
			),
		)
		.reduce((a, b) => [...a, ...b], []);
	const compositions: readonly MercenariesComposition[] = mmrPercentiles
		.map(percentile =>
			buildCompositionsForDifficulty(
				rows.filter(row => row.rating >= percentile.mmr),
				percentile.percentile,
			),
		)
		.reduce((a, b) => [...a, ...b], []);
	return {
		mmrPercentiles: mmrPercentiles,
		heroStats: heroStats,
		compositions: compositions,
	};
};

const buildPvE = (rows: MercenariesDbRow[]): MercenariesPve => {
	const heroStats: readonly MercenariesHeroStat[] = ['normal', 'heroic', 'legendary']
		.map(difficulty =>
			buildHeroStatsForDifficulty(
				rows.filter(row => row.difficulty === difficulty),
				difficulty,
			),
		)
		.reduce((a, b) => [...a, ...b], []);
	const compositions: readonly MercenariesComposition[] = ['normal', 'heroic', 'legendary']
		.map(difficulty =>
			buildCompositionsForDifficulty(
				rows.filter(row => row.difficulty === difficulty),
				difficulty,
			),
		)
		.reduce((a, b) => [...a, ...b], []);
	return {
		heroStats: heroStats,
		compositions: compositions,
	};
};

const buildCompositionsForDifficulty = (rows: MercenariesDbRow[], difficulty): readonly MercenariesComposition[] => {
	const allTimeStats = buildCompositions(rows, difficulty, 'all-time');
	console.log('built compositions for', difficulty, allTimeStats.length, rows.length);
	return [...allTimeStats];
};

const buildHeroStatsForDifficulty = (rows: MercenariesDbRow[], difficulty): readonly MercenariesHeroStat[] => {
	const allTimeStats = buildHeroStats(rows, difficulty, 'all-time');
	console.log('built stats for', difficulty, allTimeStats.length, rows.length);
	return [...allTimeStats];
};

const buildCompositions = (
	rows: readonly MercenariesDbRow[],
	difficulty: string,
	period: string,
): readonly MercenariesComposition[] => {
	const groupedByMatch = groupByFunction((row: MercenariesDbRow) => row.reviewId)(rows);
	const matchInfos = Object.values(groupedByMatch).map(infos => {
		const ref = infos[0];
		return {
			starterHeroCardIds: infos
				.filter(info => info.battleEnterTiming === 0)
				.map(info => info.heroCardId)
				.sort(),
			benchHeroCardIds: infos
				.filter(info => info.battleEnterTiming != 0)
				.map(info => info.heroCardId)
				.sort(),
			result: ref.result,
		};
	});
	const groupedByStarters = groupByFunction((matchInfo: any) => matchInfo.starterHeroCardIds.join(','))(matchInfos);
	return Object.values(groupedByStarters)
		.map(matchInfos => {
			const ref = matchInfos[0];
			const tempBenches: readonly MercenariesCompositionBench[] = matchInfos.map(matchInfo => ({
				heroCardIds: matchInfo.benchHeroCardIds,
				totalMatches: 1,
				totalWins: matchInfo.result === 'won' ? 1 : 0,
				totalLosses: matchInfo.result === 'lost' ? 1 : 0,
			}));
			const groupedByBench = groupByFunction((bench: MercenariesCompositionBench) => bench.heroCardIds.join(','))(
				tempBenches,
			);
			const benches: readonly MercenariesCompositionBench[] = Object.values(groupedByBench)
				.map(benches => {
					const ref = benches[0];
					return {
						heroCardIds: ref.heroCardIds,
						totalMatches: sumOnArray(benches, bench => bench.totalMatches),
						totalWins: sumOnArray(benches, bench => bench.totalWins),
						totalLosses: sumOnArray(benches, bench => bench.totalLosses),
					};
				})
				.sort((a, b) => b.totalWins / b.totalMatches - a.totalWins / a.totalMatches)
				.slice(0, 10);
			return {
				stringifiedHeroes: ref.starterHeroCardIds.join(','),
				date: period,
				heroCardIds: ref.starterHeroCardIds,
				mmrPercentile: difficulty,
				totalMatches: matchInfos.length,
				totalWins: matchInfos.filter(info => info.result === 'won').length,
				totalLosses: matchInfos.filter(info => info.result === 'lost').length,
				benches: benches,
			} as MercenariesComposition;
		})
		.sort((a, b) => b.totalWins / b.totalMatches - a.totalWins / a.totalMatches)
		.slice(0, 250);
};

const buildHeroStats = (
	rows: readonly MercenariesDbRow[],
	difficulty: string,
	period: string,
): readonly MercenariesHeroStat[] => {
	const grouped: { [groupingKey: string]: readonly MercenariesDbRow[] } = groupByFunction(
		(row: MercenariesDbRow) =>
			`${row.heroCardId}-${row.equipmentCardId}-${row.battleEnterTiming === 0}-${clampHeroLevel(row.heroLevel)}`,
	)(rows);
	return Object.values(grouped).map(groupedRows => {
		const ref = groupedRows[0];
		const uniqueSkills = [
			...new Set(
				groupedRows
					.map(row => [row.firstSkillCardId, row.secondSkillCardId, row.thirdSkillCardId])
					.reduce((a, b) => a.concat(b), []),
			),
		]
			.filter(cardId => cardId)
			.sort();
		const skillInfos = uniqueSkills
			.map(skillCardId => groupedRows.map(row => getSkill(row, skillCardId)))
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
			totalMatches: groupedRows.length,
			totalWins: groupedRows.filter(row => row.result === 'won').length,
			totalLosses: groupedRows.filter(row => row.result === 'lost').length,
			skillInfos: mergedSkillInfos,
		} as MercenariesHeroStat;
	});
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
	// console.debug('percentiles', median, top25, top10, top1);
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
	const query = `
		SELECT * FROM duels_stats_by_run
		WHERE runEndDate > DATE_SUB(NOW(), INTERVAL 100 DAY)
		AND decklist IS NOT NULL;
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
