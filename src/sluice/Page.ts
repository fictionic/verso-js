import React from 'react';

export type PageStyle = string | { href: string };

export interface HandleRouteResult {
  status: number;
};

type MaybePromise<T> = T | Promise<T>;

export interface Page {
  handleRoute(): MaybePromise<HandleRouteResult>;
  getTitle(): string;
  getStyles(): PageStyle[];
  getElements(): React.ReactElement[];
}
