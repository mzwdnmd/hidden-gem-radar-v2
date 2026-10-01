import { extractCanonicalBrand } from "@/lib/brand-normalizer";

// Transcribed from the owner's "已屏蔽品牌" list shared on 2026-10-01.
// Only brand names are public; local labels, notes and review evidence stay private.
export const PUBLIC_CHAIN_BRANDS = [
  { name: "1点点", aliases: [] },
  { name: "正新鸡排", aliases: [] },
  { name: "李与白包子铺", aliases: [] },
  { name: "隆广顺猪脚饭", aliases: [] },
  { name: "塔斯汀中国汉堡", aliases: ["塔斯汀"] },
  { name: "绵阳开元米粉", aliases: [] },
  { name: "幸运咖", aliases: [] },
  { name: "宜宾燃面", aliases: [] },
  { name: "肯悦咖啡(招商花园城)", aliases: ["肯悦咖啡"] },
  { name: "临榆炸鸡腿", aliases: [] },
  { name: "周黑鸭", aliases: [] },
  { name: "茉莉奶白", aliases: [] },
  { name: "瑞幸咖啡", aliases: [] },
  { name: "蒙自小黄牛米线", aliases: [] },
  { name: "巴味仙螺蛳面", aliases: [] },
  { name: "沙县小吃", aliases: [] },
] as const;

const canonicalNames = new Set(PUBLIC_CHAIN_BRANDS.flatMap((entry) => [entry.name, ...entry.aliases])
  .map((name) => extractCanonicalBrand(name).replace(/\([^)]*\)$/u, "")));

export function isPublicChainName(name: string): boolean {
  const canonical = extractCanonicalBrand(name).replace(/\([^)]*\)$/u, "");
  return canonical.length > 0 && canonicalNames.has(canonical);
}
