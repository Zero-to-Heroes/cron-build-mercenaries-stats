export interface MercenariesGlobalStats {
	readonly lastUpdateDate: Date;
	readonly pve: MercenariesPve;
	readonly pvp: MercenariesPvp;
}

export interface MercenariesPve {
	// Uses difficulty instead of MMR percentile
	readonly heroStats: readonly MercenariesHeroStat[];
	readonly compositions: readonly MercenariesComposition[];
	// treasures: readonly MercenariesTreasureStat[];
}

export interface MercenariesPvp {
	readonly mmrPercentiles: readonly MmrPercentile[];
	readonly heroStats: readonly MercenariesHeroStat[];
	readonly compositions: readonly MercenariesComposition[];
}

export interface MercenariesComposition {
	readonly date: 'all-time' | 'past-seven' | 'past-three' | 'last-patch';
	readonly heroCardIds: readonly string[];
	readonly mmrPercentile: 100 | 50 | 25 | 10 | 1 | 'normal' | 'heroic' | 'legendary';
	readonly totalMatches: number;
	readonly totalWins: number;
	readonly totalLosses: number;
	readonly benches: readonly MercenariesCompositionBench[];
}

export interface MercenariesCompositionBench {
	readonly heroCardIds: readonly string[];
	readonly totalMatches: number;
	readonly totalWins: number;
	readonly totalLosses: number;
}

export interface MercenariesHeroStat {
	readonly date: 'all-time' | 'past-seven' | 'past-three' | 'last-patch';
	// All card IDs normalize for skin
	readonly heroCardId: string;
	readonly heroRole: 'caster' | 'fighter' | 'protector';
	readonly equipementCardId: string;
	readonly starter: boolean;
	// Levels are grouped by range of 5?
	readonly heroLevel: Level;
	readonly equipmentLevel: Level;
	readonly skillInfos: readonly SkillInfo[];
	readonly mmrPercentile: 100 | 50 | 25 | 10 | 1 | 'normal' | 'heroic' | 'legendary';
	readonly totalMatches: number;
	readonly totalWins: number;
	readonly totalLosses: number;
}

export interface SkillInfo {
	readonly cardId: string;
	// If skill level is 0, or number is null, this means the skill wasn't available in the match
	// (usually means it's not unlocked yet)
	// readonly level: Level;
	readonly numberOfTimesUsed: number;
	readonly numberOfMatches: number;
}

export interface MmrPercentile {
	readonly mmr: number;
	readonly percentile: 100 | 50 | 25 | 10 | 1;
}

export type Level = null | 1 | 5 | 10 | 15 | 20 | 25 | 30;
