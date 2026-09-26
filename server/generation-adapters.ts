import type { GenerationAdapter } from "../src/domain/generation";

export class GenerationAdapterRegistry {
  private readonly adapters = new Map<string, GenerationAdapter>();

  constructor(adapters: readonly GenerationAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.key))
        throw new Error(`Duplicate generation adapter: ${adapter.key}`);
      this.adapters.set(adapter.key, adapter);
    }
  }

  require(key: string): GenerationAdapter {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new Error(`Generation adapter is not registered: ${key}`);
    return adapter;
  }
}
