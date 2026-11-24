export type MemoryCategory =
  | 'preference'
  | 'context'
  | 'learned'
  | 'instruction';

export type MemorySource = 'user' | 'ai_learned';

export interface ShopMemoryData {
  systemContext: string | null;
  toolContexts: Record<string, string>;
  promptVersion: number;
}

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  source: MemorySource;
  label: string | null;
  content: string;
  appliesToTools: string[] | null;
  priority: number;
  isActive: boolean;
  createdAt: Date;
}

export interface MemoryItemInput {
  content: string;
  category?: MemoryCategory;
  source?: MemorySource;
  label?: string;
  appliesToTools?: string[];
  priority?: number;
}

export interface CachedMemory {
  data: ShopMemoryData;
  version: number;
  loadedAt: Date;
}
