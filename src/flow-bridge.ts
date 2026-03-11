export interface FlowForkRaceFoldLike {
  openStream(): number;
  fork(parentStreamId: number, count: number): number[];
  race(streamIds: number[]): Promise<{ winner: number; result: Uint8Array }>;
  fold(
    streamIds: number[],
    merger: (results: Map<number, Uint8Array>) => Uint8Array,
  ): Promise<Uint8Array>;
  vent(streamId: number): void;
}

export class LogicChainFlowBridge {
  private readonly flow: FlowForkRaceFoldLike;
  private readonly chainToStream = new Map<string, number>();
  private readonly streamToChain = new Map<number, string>();

  constructor(flow: FlowForkRaceFoldLike) {
    this.flow = flow;
  }

  attachRoot(chainId = 'root'): number {
    const streamId = this.flow.openStream();
    this.bind(chainId, streamId);
    return streamId;
  }

  bind(chainId: string, streamId: number): void {
    this.chainToStream.set(chainId, streamId);
    this.streamToChain.set(streamId, chainId);
  }

  streamOf(chainId: string): number | undefined {
    return this.chainToStream.get(chainId);
  }

  chainOf(streamId: number): string | undefined {
    return this.streamToChain.get(streamId);
  }

  forkChains(parentChainId: string, childChainIds: readonly string[]): Map<string, number> {
    const parentStreamId = this.requireStream(parentChainId);
    const childStreamIds = this.flow.fork(parentStreamId, childChainIds.length);
    const mapping = new Map<string, number>();

    for (let index = 0; index < childChainIds.length; index += 1) {
      const chainId = childChainIds[index];
      const streamId = childStreamIds[index];
      if (!chainId || streamId === undefined) {
        continue;
      }
      this.bind(chainId, streamId);
      mapping.set(chainId, streamId);
    }

    return mapping;
  }

  async raceChains(
    chainIds: readonly string[],
  ): Promise<{ winnerChainId: string; result: Uint8Array }> {
    const streamIds = chainIds.map((chainId) => this.requireStream(chainId));
    const outcome = await this.flow.race(streamIds);
    const winnerChainId = this.chainOf(outcome.winner);
    if (!winnerChainId) {
      throw new Error(`Winner stream ${outcome.winner} is not bound to a chain`);
    }
    return {
      winnerChainId,
      result: outcome.result,
    };
  }

  foldChains(
    chainIds: readonly string[],
    merger: (results: Map<number, Uint8Array>) => Uint8Array,
  ): Promise<Uint8Array> {
    const streamIds = chainIds.map((chainId) => this.requireStream(chainId));
    return this.flow.fold(streamIds, merger);
  }

  ventChain(chainId: string): void {
    this.flow.vent(this.requireStream(chainId));
  }

  private requireStream(chainId: string): number {
    const streamId = this.chainToStream.get(chainId);
    if (streamId === undefined) {
      throw new Error(`Chain "${chainId}" is not bound to a flow stream`);
    }
    return streamId;
  }
}
