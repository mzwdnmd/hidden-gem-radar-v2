import type { PreferenceSample } from "@/lib/recommendation-score";

// Snapshot of the publicly shared Dianping album, checked on 2026-10-01.
// AMap IDs are recorded only where the name AND neighborhood/branch agree.
export const TRAINING_ALBUM_URL = "https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=14314835&shareid=OZhGaDRi1E_1790849820";

type TrainingAlbumEntry = {
  dianpingId: string;
  name: string;
  district: string;
  cuisine: string;
  area: string;
  amapId?: string;
  amapName?: string;
  longitude?: number;
  latitude?: number;
  averageCost?: number;
  businessArea?: string;
};

export const TRAINING_ALBUM: TrainingAlbumEntry[] = [
  { dianpingId: "629012700", name: "老厨子明档菜（龙潭寺店）", district: "成华区", cuisine: "川菜", area: "龙潭寺", amapId: "B0HR2HVARZ", amapName: "老厨子明档菜", longitude: 104.164097, latitude: 30.699405, averageCost: 64, businessArea: "龙潭" },
  { dianpingId: "1169843559", name: "何师绿色正宗臭豆腐", district: "新都区", cuisine: "小吃", area: "桂湖商圈" },
  { dianpingId: "127181381", name: "胖哥家常菜（胖哥羊肉羊杂汤金科店）", district: "成华区", cuisine: "家常菜", area: "龙潭寺", amapId: "B0FFHK1AMG", amapName: "胖哥家常菜(金科·天籁城店)", longitude: 104.168505, latitude: 30.698776, averageCost: 25, businessArea: "龙潭寺" },
  { dianpingId: "1015945483691033", name: "慢慢家旺苍酸辣粉（龙潭寺店）", district: "成华区", cuisine: "酸辣粉", area: "龙潭寺", amapId: "B0M6MDUO18", amapName: "慢慢家旺苍酸辣粉(龙潭寺店)", longitude: 104.174444, latitude: 30.693850, averageCost: 20, businessArea: "龙潭寺" },
  { dianpingId: "19285867", name: "百年老卤（老农民街店）", district: "青白江区", cuisine: "川菜", area: "幸福家园" },
  { dianpingId: "1027065528958121", name: "豆豆燊油泼面", district: "成华区", cuisine: "面馆", area: "龙潭寺", amapId: "B0MANDPHZI", amapName: "豆豆燊油泼面(龙潭店)", longitude: 104.164607, latitude: 30.701247, averageCost: 12, businessArea: "龙潭寺" },
  { dianpingId: "764408539", name: "富顺酸菜豆花火锅", district: "成华区", cuisine: "豆花火锅", area: "龙潭寺" },
  { dianpingId: "1872756273", name: "广西南宁老友粉", district: "成华区", cuisine: "米线", area: "成华区", amapId: "B0LGKCQ0PW", amapName: "广西南宁老友粉", longitude: 104.120050, latitude: 30.708971, averageCost: 18, businessArea: "青龙" },
  { dianpingId: "131433382", name: "耙锅盔·牛杂灌汤米线（安居路店）", district: "青白江区", cuisine: "米线", area: "幸福家园", amapId: "B0FFKSLPWS", amapName: "耙锅盔·牛杂灌汤米线(安居路店)", longitude: 104.262354, latitude: 30.885169, averageCost: 10, businessArea: "大弯" },
  { dianpingId: "1181326014", name: "享院火锅（龙潭寺店）", district: "成华区", cuisine: "火锅", area: "龙潭寺", amapId: "B0H10OX4LL", amapName: "享院火锅", longitude: 104.163883, latitude: 30.701510, averageCost: 95, businessArea: "龙潭寺" },
  { dianpingId: "1465338495", name: "疆来抓饭（奥园店）", district: "成华区", cuisine: "新疆菜", area: "万年场/万象城", amapId: "B0HD9600RF", amapName: "疆来抓饭(奥园广场店)", longitude: 104.135389, latitude: 30.658043, averageCost: 29, businessArea: "保和" },
  { dianpingId: "986384407", name: "豫道", district: "成华区", cuisine: "小吃", area: "十里店", amapId: "B0LKLZ7WR5", amapName: "豫道", longitude: 104.148765, latitude: 30.674800, averageCost: 14, businessArea: "二仙桥" },
  { dianpingId: "24077864", name: "老板房烧烤", district: "锦江区", cuisine: "烧烤", area: "塔子山公园", amapId: "B0K3S9HIF2", amapName: "老板房烧烤", longitude: 104.123075, latitude: 30.630243, averageCost: 91, businessArea: "五桂桥" },
  { dianpingId: "110859077", name: "艾孜海尔快餐厅·清真", district: "成华区", cuisine: "新疆菜", area: "十里店", amapId: "B0FFJCPOFH", amapName: "艾孜海尔快餐厅(和泓·东28店)", longitude: 104.131059, latitude: 30.675848, averageCost: 41 },
  { dianpingId: "1253408843", name: "希睿蛋烘糕", district: "成华区", cuisine: "甜品", area: "新华公园", amapId: "B0J6AMVMGD", amapName: "希睿蛋烘糕(双林路15号院店)", longitude: 104.110699, latitude: 30.653932, averageCost: 12, businessArea: "万年场" },
  { dianpingId: "1696074624", name: "汉堡食堂", district: "成华区", cuisine: "汉堡", area: "龙潭寺" },
  { dianpingId: "128902866", name: "陈姐春卷凉菜", district: "成华区", cuisine: "小吃", area: "双林路", amapId: "B0FFKCWA3A", amapName: "陈姐春卷凉菜", longitude: 104.103556, latitude: 30.653019, averageCost: 16, businessArea: "新鸿路" },
  { dianpingId: "1338325912", name: "小鹰艾力新疆羊肉手抓饭", district: "成华区", cuisine: "新疆菜", area: "东郊记忆", amapId: "B0KDNSBCB8", amapName: "小鹰艾力新疆抓饭店", longitude: 104.131923, latitude: 30.670820, averageCost: 31, businessArea: "东郊记忆" },
  { dianpingId: "9030974", name: "巷巷·鸡杂面（小天东街店）", district: "武侯区", cuisine: "面馆", area: "跳伞塔", amapId: "B0HKYUZ6P9", amapName: "巷巷鸡杂面(小天东街店)", longitude: 104.058724, latitude: 30.634417, averageCost: 17, businessArea: "小天竺" },
  { dianpingId: "132071984", name: "晋善面馆（牧电路店）", district: "青羊区", cuisine: "面馆", area: "西南财大/清江东路", amapId: "B0FFJ0AL8Q", amapName: "苗记晋善面馆(牧电路店)", longitude: 104.029952, latitude: 30.665541, averageCost: 14, businessArea: "草堂" },
];

export const TRAINING_ALBUM_MATCHED_IDS = new Set(TRAINING_ALBUM.flatMap((entry) => entry.amapId ? [entry.amapId] : []));

export function trainingAlbumSamples(overrides: Record<string, string>, blockedIds: Set<string>): PreferenceSample[] {
  return TRAINING_ALBUM.flatMap((entry) => {
    const id = entry.amapId ?? `dianping:${entry.dianpingId}`;
    if (overrides[id] || blockedIds.has(id)) return [];
    return [{
      feedback: "liked" as const,
      restaurant: {
        id, name: entry.amapName ?? entry.name, category: entry.cuisine, type: entry.cuisine,
        averageCost: entry.averageCost ?? null, businessArea: entry.businessArea ?? entry.area,
        longitude: entry.longitude ?? NaN, latitude: entry.latitude ?? NaN,
      },
    }];
  });
}
