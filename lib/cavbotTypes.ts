export type CavBotMetricMap = Record<string, unknown>;

export type CavBotSite = {
  id: string;
  label: string;
  origin: string; // origin only, not full path
  isActive?: boolean;
};

export interface ProjectSummary {
  project: {
    id: string;
    key?: string;
    name?: string;
    projectId?: number;
    projectKeyId?: number;
  };
  window: {
    range: string;
    from?: string;
    to?: string;
  };
  sites?: CavBotSite[];
  activeSite?: CavBotSite;
  metrics: CavBotMetricMap;
}