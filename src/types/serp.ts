export interface Entity {
  term: string;
  frequency: number;
  sources: number;
}

export interface LsiKeyword {
  term: string;
  score: number;
  frequency: number;
}

export interface SerpData {
  keyword: string;
  entities: Entity[];
  lsiKeywords: LsiKeyword[];
  topUrls: string[];
  fetchedAt: string;
}
