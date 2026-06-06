export interface TranscriptionOptions {
  model?: string;
  language?: string;
  diarization?: boolean;
  prompt?: string;
  terms?: string[];
  metadata?: Record<string, unknown>;
}

export interface SpeechSegment {
  content: string;
  startTime?: string;
  endTime?: string;
  speaker?: string;
}

export interface TranscriptionResult {
  title: string;
  segments: SpeechSegment[];
  summary: string;
  readability?: string;
}

export interface TranscriptionProvider {
  provider: string;
  transcribe(
    audioPath: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult>;
}

export interface OpenAITranscriptionClientLike {
  transcribe(
    audioPath: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult>;
}

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly provider = "openai";

  constructor(private readonly client: OpenAITranscriptionClientLike) {}

  async transcribe(
    audioPath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    return this.client.transcribe(audioPath, options);
  }
}

export interface GeminiTranscriptionClientLike {
  transcribe(
    audioPath: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult>;
}

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  readonly provider = "gemini";

  constructor(private readonly client: GeminiTranscriptionClientLike) {}

  async transcribe(
    audioPath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    return this.client.transcribe(audioPath, options);
  }
}

export interface AudioChunk {
  path: string;
  startSecond: number;
  endSecond: number;
  overlapStartSecond: number;
}

export interface SplitAudioOptions {
  durationSeconds?: number;
  chunkDurationSeconds?: number;
  overlapSeconds?: number;
  getDuration?: (audioPath: string) => Promise<number>;
}

export async function getAudioDuration(_audioPath: string): Promise<number> {
  throw new Error(
    "getAudioDuration requires ffmpeg integration or a custom duration resolver"
  );
}

export async function splitAudio(
  audioPath: string,
  outputDir: string,
  options: SplitAudioOptions = {}
): Promise<AudioChunk[]> {
  const chunkDuration = options.chunkDurationSeconds ?? 600;
  const overlap = options.overlapSeconds ?? 15;

  if (overlap >= chunkDuration) {
    throw new Error(
      `overlapSeconds (${overlap}) must be less than chunkDurationSeconds (${chunkDuration})`
    );
  }

  const duration =
    options.durationSeconds ??
    (await (options.getDuration ? options.getDuration(audioPath) : getAudioDuration(audioPath)));

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Audio duration must be greater than zero");
  }

  const chunks: AudioChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < duration) {
    const end = Math.min(start + chunkDuration, duration);
    const overlapStart = Math.max(start - overlap, 0);

    chunks.push({
      path: `${outputDir}/chunk-${index}.wav`,
      startSecond: start,
      endSecond: end,
      overlapStartSecond: overlapStart
    });

    if (end >= duration) {
      break;
    }

    start = end - overlap;
    index += 1;
  }

  return chunks;
}

function mergeResults(results: TranscriptionResult[]): TranscriptionResult {
  const first = results[0];
  const segments = results.flatMap((result) => result.segments);
  const summary = results.map((result) => result.summary).join("\n\n");

  return {
    title: first.title,
    segments,
    summary,
    readability: first.readability
  };
}

export class ConsensusTranscriptionProvider implements TranscriptionProvider {
  readonly provider = "consensus";

  constructor(
    private readonly providers: TranscriptionProvider[],
    private readonly mode: "first-success" | "merge" = "merge"
  ) {
    if (providers.length === 0) {
      throw new Error("ConsensusTranscriptionProvider requires at least one provider");
    }
  }

  async transcribe(
    audioPath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const results: TranscriptionResult[] = [];
    const errors: Error[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.transcribe(audioPath, options);
        if (this.mode === "first-success") {
          return result;
        }
        results.push(result);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (results.length > 0) {
      return mergeResults(results);
    }

    throw new Error(
      `All transcription providers failed: ${errors.map((error) => error.message).join("; ")}`
    );
  }
}
