/**
 * Small bilingual team alias table (grill ≤30).
 * Keys: lowercase English canonical names used in odds/results feeds.
 * Values: preferred HK/zh labels for search + display.
 */
const EN_TO_ZH: Record<string, string> = {
  kups: "古比斯",
  "vps vaasa": "VPS華沙",
  "ifk mariehamn": "馬利漢",
  "hjk helsinki": "赫爾辛基",
  "sjk seinajoki": "塞伊奈約基",
  "ac oulu": "奧盧",
  gnistan: "格尼斯丹",
  ilves: "伊爾維斯",
  haka: "哈卡",
  lahti: "拉赫蒂",
  celtic: "些路迪",
  "ac milan": "AC米蘭",
  "manchester city": "曼城",
  "manchester united": "曼聯",
  liverpool: "利物浦",
  arsenal: "阿仙奴",
  chelsea: "車路士",
  tottenham: "熱刺",
  "real madrid": "皇馬",
  barcelona: "巴塞",
  "bayern munich": "拜仁",
  "psv eindhoven": "PSV燕豪芬",
  ajax: "阿積士",
  porto: "波圖",
  benfica: "賓菲加",
  "sporting lisbon": "士砵亭",
  juventus: "祖雲達斯",
  "inter milan": "國際米蘭",
};

const ZH_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(EN_TO_ZH).map(([en, zh]) => [zh.toLowerCase(), en]),
);

/** Extra zh variants → english key */
const ZH_VARIANTS: Record<string, string> = {
  古比斯: "kups",
  庫普斯: "kups",
  库普斯: "kups",
  vps華沙: "vps vaasa",
  vps华沙: "vps vaasa",
};

function normKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** English team name → zh label if known. */
export function teamZhFromEnglish(english: string | undefined | null): string | undefined {
  if (!english?.trim()) return undefined;
  return EN_TO_ZH[normKey(english)];
}

/**
 * Expand a free-text query into match terms (lowercase).
 * "古比斯" → ["古比斯", "kups"]; "KuPS" → ["kups", "古比斯"].
 */
export function expandTeamSearchTerms(query: string): string[] {
  const q = normKey(query);
  if (!q) return [];
  const terms = new Set<string>([q]);

  const fromVariant = ZH_VARIANTS[query.trim()] ?? ZH_VARIANTS[q];
  if (fromVariant) {
    terms.add(fromVariant);
    const zh = EN_TO_ZH[fromVariant];
    if (zh) terms.add(zh.toLowerCase());
  }

  const fromZh = ZH_TO_EN[q];
  if (fromZh) {
    terms.add(fromZh);
    const zh = EN_TO_ZH[fromZh];
    if (zh) terms.add(zh.toLowerCase());
  }

  const fromEn = EN_TO_ZH[q];
  if (fromEn) terms.add(fromEn.toLowerCase());

  for (const [zh, en] of Object.entries(ZH_TO_EN)) {
    if (zh.includes(q) || q.includes(zh)) {
      terms.add(zh);
      terms.add(en);
    }
  }
  for (const [zh, en] of Object.entries(ZH_VARIANTS)) {
    const zk = normKey(zh);
    if (zk.includes(q) || q.includes(zk)) {
      terms.add(zk);
      terms.add(en);
    }
  }

  return [...terms];
}

/** Enrich a pick with zh labels from alias table when missing. */
export function enrichPickWithAliases<T extends {
  homeTeam: string;
  awayTeam: string;
  homeTeamZh?: string;
  awayTeamZh?: string;
}>(pick: T): T {
  return {
    ...pick,
    homeTeamZh: pick.homeTeamZh?.trim() || teamZhFromEnglish(pick.homeTeam),
    awayTeamZh: pick.awayTeamZh?.trim() || teamZhFromEnglish(pick.awayTeam),
  };
}
