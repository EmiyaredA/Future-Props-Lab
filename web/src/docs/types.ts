export type GuideImage = {
  src: string;
  alt: string;
  caption: string;
};

export type GuideTable = {
  headers: string[];
  rows: string[][];
};

export type GuideSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
  note?: string;
  table?: GuideTable;
  image?: GuideImage;
};

export type GuidePage = {
  id: string;
  group: "开始使用" | "视觉创作工坊" | "Galgame 工坊" | "视频剪辑工坊";
  title: string;
  eyebrow: string;
  lead: string;
  sections: GuideSection[];
};

export type GuideGroup = {
  title: GuidePage["group"];
  pages: GuidePage[];
};
