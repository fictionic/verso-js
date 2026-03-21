import React from 'react';

export type Stylesheet = { href: string } | { text: string; type?: string; media?: string };

export interface HandleRouteResult {
  status: number;
};

type MaybePromise<T> = T | Promise<T>;

export interface Page {
  handleRoute(): MaybePromise<HandleRouteResult>;
  getTitle(): string;
  getHeadStylesheets(): Stylesheet[];
  getElements(): React.ReactElement[];
}
