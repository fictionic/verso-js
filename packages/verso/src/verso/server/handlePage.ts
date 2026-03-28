import {makeStreamer} from './stream';
import type {StandardizedPage} from '../core/handler/Page';

const RENDER_TIMEOUT_MS = 20_000;

interface Options {
  renderTimeout?: number;
};

export async function handlePage(
  page: StandardizedPage,
  {
    renderTimeout = RENDER_TIMEOUT_MS,
  }: Options = {},
): Promise<ReadableStream> {
  const streamer = makeStreamer(page, { renderTimeout });
  const readable = streamer.stream();
  return readable;
}

