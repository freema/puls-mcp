import type { ShopMemoryData } from './types.js';

/**
 * Compose a tool description with per-shop memory blocks the LLM should see.
 * If memory is disabled or empty for this tool, returns the base description.
 */
export function enhanceToolDescription(
  toolName: string,
  baseDescription: string,
  memory: ShopMemoryData | null
): string {
  if (!memory) return baseDescription;
  const toolContext = memory.toolContexts[toolName];
  if (!toolContext) return baseDescription;
  return `${baseDescription}\n\n[Shop preferences for ${toolName}]\n${toolContext}`;
}

export function buildSystemContextBlock(
  memory: ShopMemoryData | null
): string | null {
  if (!memory?.systemContext) return null;
  return `[Shop preferences]\n${memory.systemContext}`;
}
